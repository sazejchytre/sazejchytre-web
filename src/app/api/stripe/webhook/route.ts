import { type NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { stripe, getPlanFromPriceId } from '@/lib/stripe/server'

function getRawAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const db = getRawAdminClient()

  // Idempotency: check if already processed
  const { data: existingEvent } = await db
    .from('stripe_events')
    .select('id, processed')
    .eq('stripe_event_id', event.id)
    .single()

  const existing = existingEvent as { id: string; processed: boolean } | null

  if (existing?.processed) {
    return NextResponse.json({ received: true, skipped: 'already_processed' })
  }

  if (!existing) {
    await db.from('stripe_events').insert({
      stripe_event_id: event.id,
      type: event.type,
      processed: false,
      payload: event as unknown as Record<string, unknown>,
    })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(session, db)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionChange(subscription, db)
        break
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(subscription, db)
        break
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoiceSucceeded(invoice, db)
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoiceFailed(invoice, db)
        break
      }
      default:
        break
    }

    await db
      .from('stripe_events')
      .update({ processed: true })
      .eq('stripe_event_id', event.id)

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error(`Error processing webhook ${event.type}:`, err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function getUserIdFromCustomer(customerId: string, db: SupabaseClient): Promise<string | null> {
  const { data } = await db
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single()
  return (data as { user_id: string } | null)?.user_id ?? null
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, db: SupabaseClient) {
  if (session.mode !== 'subscription') return

  const userId = session.metadata?.user_id
  const plan = session.metadata?.plan

  if (!userId || !plan) return

  const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription as string)
  const priceId = stripeSubscription.items.data[0]?.price.id
  const resolvedPlan = plan ?? getPlanFromPriceId(priceId ?? '')

  if (!resolvedPlan) return

  await upsertSubscription(userId, session.customer as string, stripeSubscription, resolvedPlan, db)
}

async function handleSubscriptionChange(subscription: Stripe.Subscription, db: SupabaseClient) {
  const userId = subscription.metadata?.user_id
    ?? await getUserIdFromCustomer(subscription.customer as string, db)

  if (!userId) return

  const priceId = subscription.items.data[0]?.price.id
  const plan = subscription.metadata?.plan ?? getPlanFromPriceId(priceId ?? '')

  if (!plan) return

  await upsertSubscription(userId, subscription.customer as string, subscription, plan, db)
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, db: SupabaseClient) {
  const userId = subscription.metadata?.user_id
    ?? await getUserIdFromCustomer(subscription.customer as string, db)

  if (!userId) return

  const item = subscription.items.data[0]
  const periodStart = item?.current_period_start ?? 0
  const periodEnd = item?.current_period_end ?? 0

  await db.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: subscription.customer as string,
    stripe_subscription_id: subscription.id,
    status: 'canceled',
    plan: null,
    cancel_at_period_end: false,
    current_period_start: new Date(periodStart * 1000).toISOString(),
    current_period_end: new Date(periodEnd * 1000).toISOString(),
  })

  await db.from('user_entitlements').upsert({
    user_id: userId,
    plan: 'start',
    active: false,
    source: 'stripe',
    valid_until: new Date(periodEnd * 1000).toISOString(),
  })
}

async function handleInvoiceSucceeded(invoice: Stripe.Invoice, db: SupabaseClient) {
  const sub = invoice.parent?.subscription_details?.subscription
  if (!sub) return
  const subscriptionId = typeof sub === 'string' ? sub : sub.id
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  await handleSubscriptionChange(subscription, db)
}

async function handleInvoiceFailed(invoice: Stripe.Invoice, db: SupabaseClient) {
  const customerRaw = invoice.customer
  if (!customerRaw) return
  const customerId = typeof customerRaw === 'string' ? customerRaw : customerRaw.id

  const userId = await getUserIdFromCustomer(customerId, db)
  if (!userId) return

  await db.from('subscriptions').update({ status: 'past_due' }).eq('user_id', userId)
  await db.from('user_entitlements').update({ active: false }).eq('user_id', userId)
}

async function upsertSubscription(
  userId: string,
  customerId: string,
  subscription: Stripe.Subscription,
  plan: string,
  db: SupabaseClient
) {
  const isActive = ['active', 'trialing'].includes(subscription.status)
  const item = subscription.items.data[0]
  const periodStart = item?.current_period_start ?? 0
  const periodEnd = item?.current_period_end ?? 0

  await db.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    plan,
    status: subscription.status,
    current_period_start: new Date(periodStart * 1000).toISOString(),
    current_period_end: new Date(periodEnd * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
  })

  await db.from('user_entitlements').upsert({
    user_id: userId,
    plan,
    active: isActive,
    source: 'stripe',
    valid_until: new Date(periodEnd * 1000).toISOString(),
  })
}
