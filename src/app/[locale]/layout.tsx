import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'hero' })

  const localeLabels: Record<string, string> = {
    cs: 'cs_CZ',
    en: 'en_US',
    sk: 'sk_SK',
  }

  return {
    title: {
      default: 'SázejChytře - Prémiové sázkové analýzy',
      template: '%s | SázejChytře',
    },
    description: t('subtitle'),
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}`,
      languages: {
        'cs-CZ': `${process.env.NEXT_PUBLIC_APP_URL}/cs`,
        'en-US': `${process.env.NEXT_PUBLIC_APP_URL}/en`,
        'sk-SK': `${process.env.NEXT_PUBLIC_APP_URL}/sk`,
      },
    },
    openGraph: {
      type: 'website',
      locale: localeLabels[locale] ?? 'cs_CZ',
      alternateLocale: Object.entries(localeLabels)
        .filter(([l]) => l !== locale)
        .map(([, v]) => v),
      siteName: 'SázejChytře',
      url: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}`,
    },
  }
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!routing.locales.includes(locale as 'cs' | 'en' | 'sk')) {
    notFound()
  }

  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
