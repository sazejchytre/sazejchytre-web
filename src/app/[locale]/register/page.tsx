import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { RegisterForm } from '@/components/auth/register-form'
import { Link } from '@/i18n/navigation'
import { TrendingUp } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return { title: t('registerTitle') }
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gradient-hero px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 font-bold text-xl">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-brand">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <span className="text-gradient">SázejChytře</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold">{t('registerTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('registerSubtitle')}</p>
        </div>

        <RegisterForm locale={locale} />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('hasAccount')}{' '}
          <Link href="/login" className="text-primary hover:underline">
            {t('signInHere')}
          </Link>
        </p>
      </div>
    </div>
  )
}
