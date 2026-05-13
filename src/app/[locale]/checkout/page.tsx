import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Navbar } from '@/components/layout/navbar'
import { CheckoutForm } from '@/components/checkout/checkout-form'
import { createClient } from '@/lib/supabase/server'

const VALID_PLANS = ['start', 'smart', 'elite'] as const
type Plan = (typeof VALID_PLANS)[number]

const PLAN_PRICES: Record<Plan, string> = {
  start: '749 Kč',
  smart: '1 290 Kč',
  elite: '1 990 Kč',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'checkout' })
  return { title: t('title') }
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ plan?: string }>
}) {
  const { locale } = await params
  const { plan } = await searchParams

  if (!VALID_PLANS.includes(plan as Plan)) {
    redirect(`/${locale}/pricing`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${locale}/prihlaseni?redirect=/${locale}/checkout?plan=${plan}`)
  }

  const t = await getTranslations({ locale, namespace: 'checkout' })
  const pt = await getTranslations({ locale, namespace: 'plans' })

  const validPlan = plan as Plan
  const features = pt.raw(`${validPlan}.features`) as string[]

  return (
    <>
      <Navbar locale={locale} />
      <main className="min-h-screen bg-background">
        <div className="container max-w-[1280px] py-12 lg:py-20">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-5 lg:gap-16 items-start">

            {/* Order summary */}
            <div className="lg:col-span-2 lg:sticky lg:top-24">
              <div className="rounded-2xl border border-border bg-white card-shadow p-7">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-5">
                  {t('orderSummary')}
                </p>

                <div className="flex items-center gap-4 mb-6 pb-6 border-b border-border">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl gradient-brand shadow-md shadow-brand-300/25 shrink-0">
                    <span className="text-white font-black text-sm">{pt(`${validPlan}.name`)}</span>
                  </div>
                  <div>
                    <div className="font-black text-xl text-forest">{PLAN_PRICES[validPlan]}</div>
                    <div className="text-sm text-muted-foreground">{t('perMonth')}</div>
                  </div>
                </div>

                <ul className="space-y-2.5">
                  {features.map((f: string) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                        <svg className="h-3 w-3 text-primary" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-7 pt-6 border-t border-border space-y-2.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <svg className="h-3.5 w-3.5 text-primary shrink-0" fill="none" viewBox="0 0 16 16">
                      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a1 1 0 110 2 1 1 0 010-2zm0 3.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 7.5z" fill="currentColor" />
                    </svg>
                    {t('cancelAnytime')}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <svg className="h-3.5 w-3.5 text-primary shrink-0" fill="none" viewBox="0 0 16 16">
                      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM5.5 6.5a1 1 0 012 0v4a1 1 0 01-2 0v-4zm3 0a1 1 0 012 0v4a1 1 0 01-2 0v-4z" fill="currentColor" />
                    </svg>
                    {t('secure')}
                  </div>
                </div>
              </div>
            </div>

            {/* Payment form */}
            <div className="lg:col-span-3">
              <h1 className="text-3xl font-black text-forest mb-8">{t('title')}</h1>
              <CheckoutForm plan={validPlan} locale={locale} />
            </div>

          </div>
        </div>
      </main>
    </>
  )
}
