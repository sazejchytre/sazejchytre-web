import Stripe from 'stripe'

// SECURITY: This must only be used server-side.
// Proxy defers Stripe initialization until first use, so missing env vars during
// next build page-data collection don't crash the module.
let _stripeInstance: Stripe | null = null

function getStripeInstance(): Stripe {
  if (!_stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
    _stripeInstance = new Stripe(key, { apiVersion: '2026-04-22.dahlia' })
  }
  return _stripeInstance
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripeInstance() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

export const PLAN_PRICE_MAP: Record<string, string> = {
  basic: process.env.STRIPE_BASIC_PRICE_ID ?? '',
  pro: process.env.STRIPE_PRO_PRICE_ID ?? '',
  elite: process.env.STRIPE_ELITE_PRICE_ID ?? '',
}

export const PRICE_PLAN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(PLAN_PRICE_MAP).map(([plan, priceId]) => [priceId, plan])
)

export function getPlanFromPriceId(priceId: string): string | null {
  return PRICE_PLAN_MAP[priceId] ?? null
}
