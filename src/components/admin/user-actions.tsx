'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PlanType } from '@/types/database'

interface UserActionsProps {
  userId: string
  currentUserId: string
  userRole: string
  hasActiveEntitlement: boolean
}

export function UserActions({ userId, currentUserId, userRole, hasActiveEntitlement }: UserActionsProps) {
  const router = useRouter()
  const isSelf = userId === currentUserId

  const [selectedPlan, setSelectedPlan] = useState<PlanType>('start')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function showFeedback(message: string, type: 'success' | 'error') {
    setFeedback({ message, type })
    setTimeout(() => setFeedback(null), 2000)
  }

  async function handleGrantEntitlement() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/entitlement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      })
      if (res.ok) {
        showFeedback('Přístup udělen', 'success')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        showFeedback(data.error ?? 'Chyba při udělení přístupu', 'error')
      }
    } catch {
      showFeedback('Chyba sítě', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleRevokeEntitlement() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/entitlement`, {
        method: 'DELETE',
      })
      if (res.ok) {
        showFeedback('Přístup odebrán', 'success')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        showFeedback(data.error ?? 'Chyba při odebrání přístupu', 'error')
      }
    } catch {
      showFeedback('Chyba sítě', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleRoleToggle() {
    if (isSelf) return
    const newRole = userRole === 'admin' || userRole === 'super_admin' ? 'user' : 'admin'
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (res.ok) {
        showFeedback(newRole === 'admin' ? 'Admin nastaven' : 'Admin odebrán', 'success')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        showFeedback(data.error ?? 'Chyba při změně role', 'error')
      }
    } catch {
      showFeedback('Chyba sítě', 'error')
    } finally {
      setLoading(false)
    }
  }

  const isAdmin = userRole === 'admin' || userRole === 'super_admin'

  return (
    <div className="flex flex-col gap-1.5 min-w-[200px]">
      {/* Feedback toast */}
      {feedback && (
        <div
          className={`text-xs rounded px-2 py-1 font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Grant plan */}
      <div className="flex items-center gap-1">
        <select
          className="text-xs rounded border border-border bg-background px-2 py-1"
          value={selectedPlan}
          disabled={loading}
          onChange={(e) => setSelectedPlan(e.target.value as PlanType)}
          aria-label="Vybrat plán"
        >
          <option value="start">START</option>
          <option value="smart">SMART</option>
          <option value="elite">ELITE</option>
        </select>
        <button
          onClick={handleGrantEntitlement}
          disabled={loading}
          className="text-xs rounded bg-primary/10 text-primary hover:bg-primary/20 px-2 py-1 font-medium transition-colors disabled:opacity-50"
        >
          {loading ? '...' : 'Udělit přístup'}
        </button>
      </div>

      {/* Revoke */}
      {hasActiveEntitlement && (
        <button
          onClick={handleRevokeEntitlement}
          disabled={loading}
          className="text-xs rounded bg-red-50 text-red-600 hover:bg-red-100 px-2 py-1 font-medium transition-colors disabled:opacity-50 text-left"
        >
          {loading ? '...' : 'Odebrat přístup'}
        </button>
      )}

      {/* Role toggle */}
      {!isSelf && (
        <button
          onClick={handleRoleToggle}
          disabled={loading}
          className="text-xs rounded bg-secondary/50 text-foreground hover:bg-secondary px-2 py-1 font-medium transition-colors disabled:opacity-50 text-left"
        >
          {loading ? '...' : isAdmin ? 'Odebrat admin' : 'Nastavit admin'}
        </button>
      )}
    </div>
  )
}
