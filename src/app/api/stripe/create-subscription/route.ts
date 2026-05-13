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
  if (!priceId) return NextResponse.json({ error: 'Plan not configured' }, { status: 500 })
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })
  }

  try {
    const db = getRawAdminClient()

    // Get or create Stripe customer
    const { data: existingSub } = await db
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status')
      .eq('user_id', user.id)
      .single()

    const existing = existingSub as {
      stripe_customer_id: string | null
      stripe_subscription_id: string | null
      status: string | null
    } | null

    // Block if already has active subscription
    if (existing?.status === 'active' || existing?.status === 'trialing') {
      return NextResponse.json({ error: 'Already subscribed' }, { status: 409 })
    }

    let customerId = existing?.stripe_customer_id ?? null

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

    // Reuse existing incomplete subscription for same price, cancel others
    const incompleteSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'incomplete',
      limit: 5,
      expand: ['data.latest_invoice'],
    })

    for (const sub of incompleteSubs.data) {
      const invoice = sub.latest_invoice as Stripe.Invoice | null
      const matchesPrice = sub.items.data[0]?.price.id === priceId
      if (matchesPrice && invoice?.confirmation_secret?.client_secret) {
        return NextResponse.json({
          clientSecret: invoice.confirmation_secret.client_secret,
          subscriptionId: sub.id,
        })
      }
      // Different plan — cancel it
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

    const invoice = subscription.latest_invoice as Stripe.Invoice | null
    const clientSecret = invoice?.confirmation_secret?.client_secret

    if (!clientSecret) {
      return NextResponse.json({ error: 'Failed to get payment secret' }, { status: 500 })
    }

    return NextResponse.json({ clientSecret, subscriptionId: subscription.id })
  } catch (err) {
    console.error('Create subscription error:', err)
    return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 })
  }
}
