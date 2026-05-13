'use client'

import { useState } from 'react'
import NextLink from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Edit, Trash2, Eye, EyeOff } from 'lucide-react'
import type { Tip, TipTranslation } from '@/types/database'

interface AdminTipsListProps {
  tips: Array<Tip & { translations: TipTranslation[] }>
  actorId: string
}

export function AdminTipsList({ tips, actorId: _actorId }: AdminTipsListProps) {
  const [localTips, setLocalTips] = useState(tips)
  const [loading, setLoading] = useState<string | null>(null)
  const [resultLoading, setResultLoading] = useState<string | null>(null)

  async function handleDelete(id: string) {
    if (!confirm('Opravdu smazat tento tip?')) return
    setLoading(id)
    try {
      const response = await fetch(`/api/admin/tips/${id}`, { method: 'DELETE' })
      if (response.ok) {
        setLocalTips((prev) => prev.filter((t) => t.id !== id))
      }
    } finally {
      setLoading(null)
    }
  }

  async function handleResultChange(id: string, result: string) {
    setResultLoading(id)
    try {
      const response = await fetch(`/api/admin/tips/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      })
      if (response.ok) {
        setLocalTips((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, result: result as Tip['result'] } : t
          )
        )
      }
    } finally {
      setResultLoading(null)
    }
  }

  async function handleTogglePublish(tip: Tip) {
    setLoading(tip.id)
    const newStatus = tip.status === 'published' ? 'draft' : 'published'
    try {
      const response = await fetch(`/api/admin/tips/${tip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (response.ok) {
        setLocalTips((prev) =>
          prev.map((t) =>
            t.id === tip.id
              ? { ...t, status: newStatus, published_at: newStatus === 'published' ? new Date().toISOString() : t.published_at }
              : t
          )
        )
      }
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Název</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Sport</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Plán</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Výsledek</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Datum</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Akce</th>
            </tr>
          </thead>
          <tbody>
            {localTips.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Žádné tipy. Vytvořte první tip.
                </td>
              </tr>
            )}
            {localTips.map((tip) => {
              const csTranslation = tip.translations.find((t) => t.locale === 'cs') ?? tip.translations[0]
              return (
                <tr key={tip.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3 font-medium max-w-[200px] truncate">
                    {csTranslation?.title ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{tip.sport}</td>
                  <td className="px-4 py-3">
                    <Badge variant={tip.required_plan as 'basic' | 'pro' | 'elite'}>
                      {tip.required_plan.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={tip.status === 'published' ? 'published' : 'draft'}>
                      {tip.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Badge
                        variant={
                          tip.result === 'won' ? 'won' :
                          tip.result === 'lost' ? 'lost' :
                          tip.result === 'void' ? 'void' :
                          'pending'
                        }
                      >
                        {tip.result}
                      </Badge>
                      <select
                        className="text-xs rounded border border-border bg-background px-2 py-1 ml-1"
                        value={tip.result}
                        disabled={resultLoading === tip.id}
                        onChange={(e) => handleResultChange(tip.id, e.target.value)}
                        aria-label="Změnit výsledek"
                      >
                        <option value="pending">pending</option>
                        <option value="won">won</option>
                        <option value="lost">lost</option>
                        <option value="void">void</option>
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {tip.match_date ? new Date(tip.match_date).toLocaleDateString('cs-CZ') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTogglePublish(tip)}
                        disabled={loading === tip.id}
                        title={tip.status === 'published' ? 'Zrušit publikaci' : 'Publikovat'}
                      >
                        {tip.status === 'published' ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <NextLink href={tip.id}>
                        <Button variant="ghost" size="icon" title="Upravit">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </NextLink>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(tip.id)}
                        disabled={loading === tip.id}
                        title="Smazat"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
