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
 * Extract client_secret from a Stripe Invoice.
 *
 * Tries three paths in order:
 * 1. invoice.confirmation_secret.client_secret  — new dahlia API field
 * 2. invoice.payment_intent.client_secret       — expanded PaymentIntent object
 * 3. Re-fetch the invoice with payment_intent expanded — guaranteed fallback
 */
async function getClientSecretFromInvoice(
  invoiceOrId: Stripe.Invoice | string
): Promise<string | null> {
  // Resolve to full invoice object
  let invoice: Stripe.Invoice
  if (typeof invoiceOrId === 'string') {
    invoice = await stripe.invoices.retrieve(invoiceOrId, {
      expand: ['payment_intent'],
    })
  } else {
    invoice = invoiceOrId
  }

  // 1. New dahlia API field
  const cs = invoice.confirmation_secret?.client_secret
  if (cs) return cs

  // 2. payment_intent already expanded inline
  const piInline = (invoice as unknown as Record<string, unknown>).payment_intent
  if (piInline && typeof piInline === 'object') {
    const secret = (piInline as { client_secret?: string }).client_secret
    if (secret) return secret
  }

  // 3. Re-fetch with payment_intent explicitly expanded
  if (invoice.id) {
    const fresh = await stripe.invoices.retrieve(invoice.id, {
      expand: ['payment_intent'],
    })
    const cs2 = fresh.confirmation_secret?.client_secret
    if (cs2) return cs2

    const piFresh = (fresh as unknown as Record<string, unknown>).payment_intent
    if (piFresh && typeof piFresh === 'object') {
      const secret = (piFresh as { client_secret?: string }).client_secret
      if (secret) return secret
    }
  }

  console.error('[create-subscription] Could not extract clientSecret. Invoice:', {
    id: invoice.id,
    status: invoice.status,
    confirmation_secret: invoice.confirmation_secret,
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
    return NextResponse.json({ error: 'Plan not configured — check Stripe price IDs in env vars' }, { status: 500 })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })
  }

  try {
    const db = getRawAdminClient()

    const { data: existingSubData } = await db
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status')
      .eq('user_id', user.id)
      .single()

    const existingSub = existingSubData as {
      stripe_customer_id: string | null
      stripe_subscription_id: string | null
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
      expand: ['data.latest_invoice'],
    })

    for (const sub of incompleteSubs.data) {
      const matchesPrice = sub.items.data[0]?.price.id === priceId
      if (matchesPrice) {
        const invoiceRaw = sub.latest_invoice
        if (invoiceRaw) {
          const clientSecret = await getClientSecretFromInvoice(
            invoiceRaw as Stripe.Invoice | string
          )
          if (clientSecret) {
            return NextResponse.json({ clientSecret, subscriptionId: sub.id })
          }
        }
      }
      // Different plan — cancel it so we can create a fresh one
      await stripe.subscriptions.cancel(sub.id)
    }

    // Create new subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice'],
      metadata: { user_id: user.id, plan },
    })

    const invoiceRaw = subscription.latest_invoice
    if (!invoiceRaw) {
      console.error('[create-subscription] No latest_invoice on subscription', subscription.id)
      return NextResponse.json({ error: 'No invoice created' }, { status: 500 })
    }

    const clientSecret = await getClientSecretFromInvoice(
      invoiceRaw as Stripe.Invoice | string
    )

    if (!clientSecret) {
      return NextResponse.json({ error: 'Failed to get payment secret' }, { status: 500 })
    }

    return NextResponse.json({ clientSecret, subscriptionId: subscription.id })
  } catch (err) {
    console.error('[create-subscription] Unexpected error:', err)
    return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 })
  }
}
