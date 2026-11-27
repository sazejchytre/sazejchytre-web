/**
 * "Jak to funguje": three ordered steps, as an ordered list.
 *
 * Not three cards with icons (DESIGN.md rule 41). The step number is the only
 * ornament, set in Geist Mono in the brand green — one of the few places the
 * green appears that is not an action — and it carries information the
 * reader can use: there is an order.
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
  <section aria-labelledby={headingId} className="flex flex-col gap-6">
    <h2 id={headingId} className="text-display-lg text-ink">
      {heading}
    </h2>

    <ol className="flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 py-6"
        >
          <span aria-hidden="true" className="text-data text-brand-text">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="flex flex-col gap-2">
            <h3 className="text-heading text-ink">{step.title}</h3>
            <p className="max-w-prose text-body text-ink-muted">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  </section>
)
