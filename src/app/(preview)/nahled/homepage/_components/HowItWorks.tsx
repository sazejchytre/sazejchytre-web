/**
 * "Jak to funguje": three ordered steps, side by side on a wide screen.
 *
 * Not three cards with icons (DESIGN.md rule 41): an ordered list on the
 * page, the step number in the brand green as the only ornament, because it
 * carries the one thing the reader needs — there is an order.
 */
export const HowItWorks = ({
  headingId,
  heading,
  steps,
}: {
  headingId: string
  heading: string
  steps: readonly { title: string; body: string }[]
}) => (
  <section aria-labelledby={headingId} className="scroll-mt-20">
    <div className="page-shell page-gutter flex flex-col gap-10 py-16 md:py-20">
      <h2 id={headingId} className="text-display-lg text-ink">
        {heading}
      </h2>

      <ol className="grid gap-10 md:grid-cols-3 md:gap-12">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-3">
            <span aria-hidden="true" className="text-data-xl text-brand-text">
              {index + 1}
            </span>
            <h3 className="text-heading text-ink">{step.title}</h3>
            <p className="max-w-prose text-body text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  </section>
)
