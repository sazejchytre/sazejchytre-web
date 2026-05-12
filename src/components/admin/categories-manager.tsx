'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Trash2, Plus } from 'lucide-react'
import type { Category, CategoryTranslation } from '@/types/database'

interface CategoriesManagerProps {
  categories: Array<Category & { translations: CategoryTranslation[] }>
  actorId: string
}

export function CategoriesManager({ categories, actorId: _actorId }: CategoriesManagerProps) {
  const [cats, setCats] = useState(categories)
  const [newSlug, setNewSlug] = useState('')
  const [newNameCs, setNewNameCs] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newSlug || !newNameCs) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: newSlug.toLowerCase().replace(/\s+/g, '-'),
          nameCs: newNameCs,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Chyba')
        return
      }
      setCats((prev) => [...prev, data.data])
      setNewSlug('')
      setNewNameCs('')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Smazat kategorii?')) return
    const response = await fetch(`/api/admin/categories/${id}`, { method: 'DELETE' })
    if (response.ok) {
      setCats((prev) => prev.filter((c) => c.id !== id))
    }
  }

  return (
    <div className="space-y-6">
      {/* Add Category */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold mb-4">Přidat kategorii</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Slug (URL identifikátor)</Label>
              <Input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="football"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Název (CS)</Label>
              <Input
                value={newNameCs}
                onChange={(e) => setNewNameCs(e.target.value)}
                placeholder="Fotbal"
                required
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading} size="sm">
            <Plus className="h-4 w-4" />
            Přidat
          </Button>
        </form>
      </div>

      {/* Category List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slug</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Název (CS)</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Akce</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((cat) => {
              const csName = cat.translations.find((t) => t.locale === 'cs')?.name ?? '—'
              return (
                <tr key={cat.id} className="border-b border-border/50">
                  <td className="px-4 py-3 font-mono text-xs">{cat.slug}</td>
                  <td className="px-4 py-3">{csName}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(cat.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
