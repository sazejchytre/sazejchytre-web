import { Monogram } from '@/components/brand/Marks'
import { Button } from '@/components/ui/Button'

/**
 * The hero: one strong band, one sentence, one obvious action.
 *
 * The deep brand green is the site's identity; the only ornament is the
 * brand's own monogram, drawn large and faint on the right on wide screens
 * and hidden from assistive technology. No sample tip, no invented figure,
 * no mock-up of a product screen — nothing in a hero that is not true.
 *
 * The H1 is text, so it is the LCP element (rule 22), and the band is under
 * half of a 900px desktop viewport (rule 38).
 */
export const Hero = ({
  heading,
  body,
  serviceStatement,
  brand,
  primary,
  secondary,
}: {
  heading: string
  body: string
  serviceStatement: string
  brand: string
  primary: { href: string; label: string }
  secondary: { href: string; label: string }
}) => (
  <section className="band-brand relative overflow-hidden">
    <div className="page-shell page-gutter relative py-16 md:py-24">
      <div className="relative z-10 flex max-w-2xl flex-col gap-6">
        <h1 className="text-display-xl">{heading}</h1>
        <p className="text-lead text-ink-muted-on-surface-brand">{body}</p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            href={primary.href}
            variant="accent"
            size="lg"
            prefetch={false}
          >
            {primary.label}
          </Button>
          <Button
            href={secondary.href}
            variant="secondary"
            size="lg"
            prefetch={false}
          >
            {secondary.label}
          </Button>
        </div>
        <p className="text-body-sm text-ink-muted-on-surface-brand">
          {serviceStatement}
        </p>
      </div>

      {/* The brand's own mark, as the one decorative element. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 end-0 hidden items-center pe-[var(--sc-page-margin)] text-signal opacity-[0.12] lg:flex"
      >
        <Monogram label={brand} className="h-40 w-auto xl:h-48" />
      </div>
    </div>
  </section>
)
