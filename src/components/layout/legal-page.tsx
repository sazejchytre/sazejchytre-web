import { AlertTriangle } from 'lucide-react'

interface LegalPageProps {
  title: string
  lastUpdated?: string
  children: React.ReactNode
}

export function LegalPage({ title, lastUpdated, children }: LegalPageProps) {
  return (
    <article className="container py-16 max-w-3xl">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-yellow-700/30 bg-yellow-900/10 px-3 py-1 text-xs text-yellow-400 mb-4">
          <AlertTriangle className="h-3 w-3" />
          Právní dokument – doporučujeme konzultaci s právníkem před ostrým provozem
        </div>
        <h1 className="text-4xl font-bold">{title}</h1>
        {lastUpdated && (
          <p className="text-sm text-muted-foreground mt-2">Poslední aktualizace: {lastUpdated}</p>
        )}
      </div>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground leading-relaxed">
        {children}
      </div>
    </article>
  )
}
