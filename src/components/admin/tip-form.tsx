'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { Tip, TipTranslation, Category } from '@/types/database'

interface TipFormProps {
  tip: (Tip & { translations: TipTranslation[] }) | null
  categories: Array<Category & { translations: { locale: string; name: string }[] }>
  actorId: string
}

const LOCALES = ['cs', 'en', 'sk'] as const

export function TipForm({ tip, categories, actorId: _actorId }: TipFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    sport: tip?.sport ?? '',
    category_id: tip?.category_id ?? '',
    required_plan: tip?.required_plan ?? 'start',
    odds: tip?.odds?.toString() ?? '',
    confidence: tip?.confidence?.toString() ?? '3',
    match_date: tip?.match_date ? tip.match_date.slice(0, 16) : '',
    status: tip?.status ?? 'draft',
    result: tip?.result ?? 'pending',
  })

  const [translations, setTranslations] = useState<
    Record<string, { title: string; summary: string; analysis: string; prediction: string }>
  >({
    cs: {
      title: tip?.translations.find((t) => t.locale === 'cs')?.title ?? '',
      summary: tip?.translations.find((t) => t.locale === 'cs')?.summary ?? '',
      analysis: tip?.translations.find((t) => t.locale === 'cs')?.analysis ?? '',
      prediction: tip?.translations.find((t) => t.locale === 'cs')?.prediction ?? '',
    },
    en: {
      title: tip?.translations.find((t) => t.locale === 'en')?.title ?? '',
      summary: tip?.translations.find((t) => t.locale === 'en')?.summary ?? '',
      analysis: tip?.translations.find((t) => t.locale === 'en')?.analysis ?? '',
      prediction: tip?.translations.find((t) => t.locale === 'en')?.prediction ?? '',
    },
    sk: {
      title: tip?.translations.find((t) => t.locale === 'sk')?.title ?? '',
      summary: tip?.translations.find((t) => t.locale === 'sk')?.summary ?? '',
      analysis: tip?.translations.find((t) => t.locale === 'sk')?.analysis ?? '',
      prediction: tip?.translations.find((t) => t.locale === 'sk')?.prediction ?? '',
    },
  })

  async function handleSubmit(e: React.FormEvent, saveStatus?: 'draft' | 'published') {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const payload = {
      ...form,
      status: saveStatus ?? form.status,
      odds: form.odds ? parseFloat(form.odds) : null,
      confidence: form.confidence ? parseInt(form.confidence) : null,
      match_date: form.match_date ? new Date(form.match_date).toISOString() : null,
      category_id: form.category_id || null,
      translations,
    }

    try {
      const url = tip ? `/api/admin/tips/${tip.id}` : '/api/admin/tips'
      const method = tip ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error ?? 'Nastala chyba')
        return
      }

      router.push('./admin/tips')
      router.refresh()
    } catch {
      setError('Nastala neočekávaná chyba')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Základní informace</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Sport *</Label>
            <Input
              value={form.sport}
              onChange={(e) => setForm({ ...form, sport: e.target.value })}
              placeholder="Fotbal, Tenis, ..."
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Kategorie</Label>
            <Select
              value={form.category_id}
              onValueChange={(v) => setForm({ ...form, category_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Vybrat kategorii" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— Bez kategorie —</SelectItem>
                {categories.map((cat) => {
                  const name = cat.translations.find((t) => t.locale === 'cs')?.name ?? cat.slug
                  return (
                    <SelectItem key={cat.id} value={cat.id}>
                      {name}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Požadovaný plán *</Label>
            <Select
              value={form.required_plan}
              onValueChange={(v) => setForm({ ...form, required_plan: v as 'start' | 'smart' | 'elite' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start">START</SelectItem>
                <SelectItem value="smart">SMART</SelectItem>
                <SelectItem value="elite">ELITE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Kurz</Label>
            <Input
              type="number"
              step="0.01"
              min="1"
              value={form.odds}
              onChange={(e) => setForm({ ...form, odds: e.target.value })}
              placeholder="2.50"
            />
          </div>
          <div className="space-y-2">
            <Label>Jistota (1-5)</Label>
            <Input
              type="number"
              min="1"
              max="5"
              value={form.confidence}
              onChange={(e) => setForm({ ...form, confidence: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Datum zápasu</Label>
            <Input
              type="datetime-local"
              value={form.match_date}
              onChange={(e) => setForm({ ...form, match_date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Výsledek</Label>
            <Select
              value={form.result}
              onValueChange={(v) => setForm({ ...form, result: v as Tip['result'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Čeká</SelectItem>
                <SelectItem value="won">Výhra</SelectItem>
                <SelectItem value="lost">Prohra</SelectItem>
                <SelectItem value="void">Anulováno</SelectItem>
                <SelectItem value="half_won">Půl výhra</SelectItem>
                <SelectItem value="half_lost">Půl prohra</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Translations */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold mb-4">Překlady</h2>
        <Tabs defaultValue="cs">
          <TabsList className="mb-4">
            {LOCALES.map((locale) => (
              <TabsTrigger key={locale} value={locale}>
                {locale.toUpperCase()}
              </TabsTrigger>
            ))}
          </TabsList>
          {LOCALES.map((locale) => (
            <TabsContent key={locale} value={locale} className="space-y-4">
              <div className="space-y-2">
                <Label>Název zápasu / Titulek {locale === 'cs' && '*'}</Label>
                <Input
                  value={translations[locale].title}
                  onChange={(e) =>
                    setTranslations({ ...translations, [locale]: { ...translations[locale], title: e.target.value } })
                  }
                  placeholder="Real Madrid vs Barcelona"
                />
              </div>
              <div className="space-y-2">
                <Label>Předpověď {locale === 'cs' && '*'}</Label>
                <Input
                  value={translations[locale].prediction}
                  onChange={(e) =>
                    setTranslations({ ...translations, [locale]: { ...translations[locale], prediction: e.target.value } })
                  }
                  placeholder="Výhra domácích"
                />
              </div>
              <div className="space-y-2">
                <Label>Krátké shrnutí</Label>
                <Textarea
                  value={translations[locale].summary}
                  onChange={(e) =>
                    setTranslations({ ...translations, [locale]: { ...translations[locale], summary: e.target.value } })
                  }
                  placeholder="Stručné shrnutí tipu..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Detailní analýza</Label>
                <Textarea
                  value={translations[locale].analysis}
                  onChange={(e) =>
                    setTranslations({ ...translations, [locale]: { ...translations[locale], analysis: e.target.value } })
                  }
                  placeholder="Hloubková analýza zápasu..."
                  rows={6}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" loading={loading} onClick={(e) => handleSubmit(e as unknown as React.FormEvent, 'published')}>
          Publikovat
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={loading}
          onClick={(e) => handleSubmit(e as unknown as React.FormEvent, 'draft')}
        >
          Uložit jako draft
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
        >
          Zrušit
        </Button>
      </div>
    </form>
  )
}
