import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { stripe, PLAN_PRICE_MAP } from '@/lib/stripe/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/utils/rate-limit'
import { getAppUrl } from '@/lib/utils/app-url'
import { headers } from 'next/headers'

function getRawAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const checkoutSchema = z.object({
  plan: z.enum(['start', 'smart', 'elite']),
  locale: z.enum(['cs', 'en', 'sk']).default('cs'),
})

export async function POST(request: NextRequest) {
  const headerStore = await headers()
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rateLimitResult = rateLimit(`checkout:${ip}`, { maxRequests: 5, windowMs: 60_000 })
  if (!rateLimitResult.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = checkoutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const { plan, locale } = parsed.data
  const priceId = PLAN_PRICE_MAP[plan]

  if (!priceId) {
    return NextResponse.json({ error: 'Plan not configured' }, { status: 500 })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Payments not yet configured' }, { status: 503 })
  }

  const appUrl = getAppUrl()

  try {
    const db = getRawAdminClient()

    const { data: existingSub } = await db
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    let customerId = (existingSub as { stripe_customer_id: string | null } | null)?.stripe_customer_id

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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${appUrl}/${locale}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/${locale}/pricing?checkout=canceled`,
      metadata: { user_id: user.id, plan },
      subscription_data: { metadata: { user_id: user.id, plan } },
      locale: locale === 'cs' ? 'cs' : locale === 'sk' ? 'sk' : 'en',
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
