'use client'

import { useState, useEffect } from 'react'
import { loadStripe, type Stripe as StripeType } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Lock } from 'lucide-react'
import type { StripeElementsOptions } from '@stripe/stripe-js'

const stripePromise: Promise<StripeType | null> = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
)

const appearance: StripeElementsOptions['appearance'] = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#5BC894',
    colorBackground: '#ffffff',
    colorText: '#1A2E1F',
    colorTextSecondary: '#6b7280',
    colorDanger: '#ef4444',
    fontFamily: '"Inter", system-ui, sans-serif',
    spacingUnit: '4px',
    borderRadius: '10px',
    fontSizeBase: '14px',
  },
  rules: {
    '.Input': {
      border: '1.5px solid #e2e8f0',
      boxShadow: 'none',
      padding: '12px 14px',
      transition: 'border-color 0.15s',
    },
    '.Input:focus': {
      border: '1.5px solid #5BC894',
      boxShadow: '0 0 0 3px rgba(91, 200, 148, 0.12)',
    },
    '.Input--invalid': {
      border: '1.5px solid #ef4444',
    },
    '.Label': {
      fontWeight: '500',
      color: '#1A2E1F',
      marginBottom: '6px',
    },
    '.Tab': {
      border: '1.5px solid #e2e8f0',
      boxShadow: 'none',
    },
    '.Tab:hover': {
      border: '1.5px solid #5BC894',
    },
    '.Tab--selected': {
      border: '1.5px solid #5BC894',
      boxShadow: '0 0 0 3px rgba(91, 200, 148, 0.12)',
    },
    '.Block': {
      border: '1.5px solid #e2e8f0',
      boxShadow: 'none',
    },
  },
}

interface PaymentFormProps {
  locale: string
}

function PaymentForm({ locale }: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const t = useTranslations('checkout')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setLoading(true)
    setError(null)

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/${locale}/dashboard?checkout=success`,
      },
    })

    // confirmPayment only returns here if there's an error (success redirects)
    if (stripeError) {
      setError(stripeError.message ?? t('errors.generic'))
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-6">
        <PaymentElement
          options={{
            layout: 'tabs',
            fields: { billingDetails: { address: 'never' } },
          }}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        variant="cta"
        size="xl"
        className="w-full gap-2"
        loading={loading}
        disabled={!stripe || !elements}
      >
        <Lock className="h-4 w-4" />
        {loading ? t('processing') : t('pay')}
      </Button>

      <p className="text-center text-xs text-muted-foreground/60">
        {t('secure')} · {t('cancelAnytime')}
      </p>
    </form>
  )
}

interface CheckoutFormProps {
  plan: 'start' | 'smart' | 'elite'
  locale: string
}

export function CheckoutForm({ plan, locale }: CheckoutFormProps) {
  const t = useTranslations('checkout')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [alreadySubscribed, setAlreadySubscribed] = useState(false)

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch('/api/stripe/create-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan, locale }),
        })

        if (res.status === 409) {
          setAlreadySubscribed(true)
          return
        }

        const data = await res.json() as { clientSecret?: string; error?: string }
        if (!res.ok || !data.clientSecret) {
          setError(data.error ?? t('errors.generic'))
          return
        }

        setClientSecret(data.clientSecret)
      } catch {
        setError(t('errors.generic'))
      }
    }
    init()
  }, [plan, locale, t])

  if (alreadySubscribed) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-8 text-center">
        <p className="text-forest mb-5">{t('alreadySubscribed')}</p>
        <Link href="/dashboard">
          <Button variant="default">{t('goToDashboard')}</Button>
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
        <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  if (!clientSecret) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-5 w-32 rounded bg-secondary" />
        <div className="rounded-2xl border border-border bg-white p-6 space-y-4">
          <div className="h-10 rounded-lg bg-secondary" />
          <div className="h-10 rounded-lg bg-secondary" />
          <div className="h-10 rounded-lg bg-secondary" />
        </div>
        <p className="text-center text-sm text-muted-foreground">{t('loadingPayment')}</p>
      </div>
    )
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance, locale: locale === 'cs' ? 'cs' : locale === 'sk' ? 'sk' : 'en' }}
    >
      <PaymentForm locale={locale} />
    </Elements>
  )
}
