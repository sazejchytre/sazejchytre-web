import { Button } from '@/components/ui/Button'

/**
 * The closing call to action: the brand band again, one sentence and one
 * button. Not a "ready to win?" device — the sentence is the record's own
 * promise, and the button opens the record.
 */
export const ClosingBand = ({
  headingId,
  heading,
  body,
  action,
}: {
  headingId: string
  heading: string
  body: string
  action: { href: string; label: string }
}) => (
  <section aria-labelledby={headingId} className="band-brand">
    <div className="page-shell page-gutter flex flex-col items-start gap-6 py-16 md:flex-row md:items-center md:justify-between md:py-20">
      <div className="flex max-w-reading flex-col gap-3">
        <h2 id={headingId} className="text-display-lg">
          {heading}
        </h2>
        <p className="text-lead text-ink-muted-on-surface-brand">{body}</p>
      </div>
      <Button href={action.href} variant="accent" size="lg" prefetch={false}>
        {action.label}
      </Button>
    </div>
  </section>
)
