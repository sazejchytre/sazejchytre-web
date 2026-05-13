import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Lock, Calendar, Star } from 'lucide-react'
import type { Tip, TipTranslation } from '@/types/database'

interface TipCardProps {
  tip: Tip
  translation: TipTranslation | null
  hasAccess: boolean
  locale: string
}

const PLAN_BADGE_MAP = {
  start: 'basic' as const,
  smart: 'pro' as const,
  elite: 'elite' as const,
}

const RESULT_BADGE_MAP = {
  won: 'won' as const,
  lost: 'lost' as const,
  void: 'void' as const,
  pending: 'pending' as const,
  half_won: 'won' as const,
  half_lost: 'lost' as const,
}

export function TipCard({ tip, translation, hasAccess, locale }: TipCardProps) {
  const t = useTranslations('tips')

  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-all hover:border-border/80">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge variant={PLAN_BADGE_MAP[tip.required_plan]}>
              {tip.required_plan.toUpperCase()}
            </Badge>
            <span className="text-xs text-muted-foreground">{tip.sport}</span>
            {tip.result !== 'pending' && (
              <Badge variant={RESULT_BADGE_MAP[tip.result]}>
                {tip.result.toUpperCase()}
              </Badge>
            )}
          </div>

          {hasAccess && translation ? (
            <>
              <h3 className="font-semibold truncate">{translation.title}</h3>
              {translation.summary && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{translation.summary}</p>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="h-5 w-3/4 rounded shimmer-bg animate-shimmer" />
              <div className="h-4 w-full rounded shimmer-bg animate-shimmer" />
            </div>
          )}

          <div className="flex items-center gap-4 mt-3">
            {hasAccess && (
              <>
                {tip.odds && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">{t('odds')}: </span>
                    <span className="font-mono font-semibold text-primary">{tip.odds}</span>
                  </div>
                )}
                {tip.confidence && (
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3 w-3 ${i < tip.confidence! ? 'fill-gold-400 text-gold-400' : 'text-muted-foreground'}`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
            {tip.match_date && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(tip.match_date).toLocaleDateString(locale === 'en' ? 'en-US' : `${locale}-CZ`)}
              </div>
            )}
          </div>
        </div>

        {!hasAccess && (
          <div className="shrink-0 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {!hasAccess && (
        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t('lockedDesc', { plan: tip.required_plan.toUpperCase() })}
          </p>
          <Link href="/pricing">
            <Button size="sm" variant="outline">
              {t('upgrade', { plan: tip.required_plan.toUpperCase() })}
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}
