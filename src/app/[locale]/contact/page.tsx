import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { Mail } from 'lucide-react'

export const metadata = { title: 'Kontakt' }

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main className="container py-16 max-w-2xl">
        <h1 className="text-4xl font-bold mb-6">Kontakt</h1>
        <p className="text-muted-foreground mb-8">
          Máte dotazy nebo potřebujete pomoc? Neváhejte nás kontaktovat.
        </p>
        <div className="rounded-xl border border-border bg-card p-8 space-y-4">
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium">Email</div>
              <a href="mailto:info@sazejchytre.cz" className="text-primary hover:underline text-sm">
                info@sazejchytre.cz
              </a>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-4 border-t border-border">
            Odpovídáme zpravidla do 24 hodin v pracovní dny.
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
