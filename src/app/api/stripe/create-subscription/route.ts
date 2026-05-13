import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { stripe, PLAN_PRICE_MAP } from '@/lib/stripe/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/utils/rate-limit'

function getRawAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const schema = z.object({
  plan: z.enum(['start', 'smart', 'elite']),
  locale: z.enum(['cs', 'en', 'sk']).default('cs'),
})

/**
 * Extract the Stripe PaymentIntent client_secret from an invoice.
 *
 * The 2026-04-22.dahlia API removed invoice.payment_intent as a top-level
 * field. client_secret now lives at two places (tried in order):
 *
 *  1. invoice.confirmation_secret.client_secret  — set after finalization
 *  2. invoice.payments.data[0].payment.payment_intent.client_secret
 *     — via the new InvoicePayment sub-resource
 *
 * If the invoice is still in draft state we finalize it first.
 */
async function resolveClientSecret(invoiceId: string): Promise<string | null> {
  // Fetch with both expansion paths at once
  let invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['payments.data.payment.payment_intent'],
  })

  // Ensure invoice is finalized — confirmation_secret is only set on open invoices
  if (invoice.status === 'draft') {
    await stripe.invoices.finalizeInvoice(invoiceId)
    invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['payments.data.payment.payment_intent'],
    })
  }

  // 1. New API field (post-finalization)
  const cs = invoice.confirmation_secret?.client_secret
  if (cs) return cs

  // 2. payments.data[0].payment.payment_intent.client_secret (dahlia API)
  const payments = invoice.payments?.data ?? []
  for (const invoicePayment of payments) {
    const rawPayment = invoicePayment as unknown as {
      payment?: { payment_intent?: string | Stripe.PaymentIntent }
    }
    const pi = rawPayment.payment?.payment_intent
    if (pi && typeof pi === 'object' && 'client_secret' in pi) {
      const secret = (pi as Stripe.PaymentIntent).client_secret
      if (secret) return secret
    }
  }

  console.error('[create-subscription] Cannot extract clientSecret', {
    invoiceId,
    status: invoice.status,
    confirmation_secret: invoice.confirmation_secret,
    paymentsCount: invoice.payments?.data?.length ?? 0,
  })
  return null
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = rateLimit(`create-sub:${ip}`, { maxRequests: 5, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const { plan } = parsed.data
  const priceId = PLAN_PRICE_MAP[plan]
  if (!priceId) {
    console.error(`[create-subscription] Price ID not configured for plan: ${plan}`)
    return NextResponse.json(
      { error: 'Plan not configured — check Stripe price IDs in Vercel env vars' },
      { status: 500 }
    )
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })
  }

  try {
    const db = getRawAdminClient()

    const { data: existingSubData } = await db
      .from('subscriptions')
      .select('stripe_customer_id, status')
      .eq('user_id', user.id)
      .single()

    const existingSub = existingSubData as {
      stripe_customer_id: string | null
      status: string | null
    } | null

    if (existingSub?.status === 'active' || existingSub?.status === 'trialing') {
      return NextResponse.json({ error: 'Already subscribed' }, { status: 409 })
    }

    // Get or create Stripe customer
    let customerId = existingSub?.stripe_customer_id ?? null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
      await db.from('subscriptions').upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        status: 'incomplete',
      })
    }

    // Reuse existing incomplete subscription for same price; cancel others
    const incompleteSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'incomplete',
      limit: 5,
    })

    for (const sub of incompleteSubs.data) {
      const matchesPrice = sub.items.data[0]?.price.id === priceId
      const invoiceId = typeof sub.latest_invoice === 'string'
        ? sub.latest_invoice
        : sub.latest_invoice?.id

      if (matchesPrice && invoiceId) {
        const clientSecret = await resolveClientSecret(invoiceId)
        if (clientSecret) {
          return NextResponse.json({ clientSecret, subscriptionId: sub.id })
        }
      }
      // Different plan or can't reuse — cancel so we can create fresh
      await stripe.subscriptions.cancel(sub.id)
    }

    // Create new subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: { user_id: user.id, plan },
    })

    const invoiceId = typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id

    if (!invoiceId) {
      console.error('[create-subscription] No invoice on subscription', subscription.id)
      return NextResponse.json({ error: 'No invoice created' }, { status: 500 })
    }

    const clientSecret = await resolveClientSecret(invoiceId)

    if (!clientSecret) {
      return NextResponse.json({ error: 'Failed to get payment secret' }, { status: 500 })
    }

    return NextResponse.json({ clientSecret, subscriptionId: subscription.id })
  } catch (err) {
    console.error('[create-subscription] Unexpected error:', err)
    return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 })
  }
}
