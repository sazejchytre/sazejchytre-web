/**
 * Sport and date-range filters. A plain GET form.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO JAVASCRIPT, AND THE REASON IS NOT PURITY
 *
 * `method="get"` on a form puts its fields in the query string and navigates.
 * That is the whole mechanism: the resulting view is linkable, bookmarkable,
 * survives a reload, works with the back button, and is rendered on the
 * server so the filtered table is in the HTML. A `useState` version would be
 * none of those things and would also need the sort state threading through
 * it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE SORT IS CARRIED THROUGH AS A HIDDEN FIELD
 *
 * Without it, applying a filter silently resets the column the reader had
 * sorted by — which looks like the page losing its place.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THERE IS NO RESULT FILTER, AND THE PAGE SAYS SO
 *
 * Not as a quiet omission: the note is rendered next to the controls. A
 * reader looking for "show me only the wins" should find out immediately that
 * it is deliberate rather than missing, because the absence is the point —
 * a history from which the losses can be filtered out is not evidence of
 * anything. `ArchiveFilter` has no field for it either, so no component can
 * add one by accident.
 */
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import {
  type ArchiveQuery,
  DEFAULT_DIRECTION,
  DEFAULT_SORT,
} from '@/lib/tips/archive'

export type HistoryFiltersLabels = {
  heading: string
  sport: string
  allSports: string
  from: string
  to: string
  apply: string
  reset: string
  noResultFilterNote: string
}

export type HistoryFiltersProps = {
  query: ArchiveQuery
  sports: readonly { code: string; name: string }[]
  labels: HistoryFiltersLabels
  /** Where the form submits. Also the reset target. */
  basePath: string
}

export const HistoryFilters = ({
  query,
  sports,
  labels,
  basePath,
}: HistoryFiltersProps) => (
  <form
    method="get"
    action={basePath}
    className="flex flex-col gap-4"
    aria-labelledby="filtr-nadpis"
  >
    <h3 id="filtr-nadpis" className="text-label text-ink">
      {labels.heading}
    </h3>

    {/* The sort, preserved. Only emitted when it differs from the default,
        so the common case produces a clean URL. */}
    {query.sort !== DEFAULT_SORT ? (
      <input type="hidden" name="razeni" value={query.sort} />
    ) : null}
    {query.direction !== DEFAULT_DIRECTION ? (
      <input type="hidden" name="smer" value={query.direction} />
    ) : null}

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
      <Field id="filtr-sport" label={labels.sport}>
        {({ id }) => (
          <Select id={id} name="sport" defaultValue={query.filter.sport ?? ''}>
            <option value="">{labels.allSports}</option>
            {sports.map((sport) => (
              <option key={sport.code} value={sport.code}>
                {sport.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="filtr-od" label={labels.from}>
        {({ id }) => (
          <Input
            id={id}
            name="od"
            type="date"
            defaultValue={query.filter.from ?? ''}
          />
        )}
      </Field>

      <Field id="filtr-do" label={labels.to}>
        {({ id }) => (
          <Input
            id={id}
            name="do"
            type="date"
            defaultValue={query.filter.to ?? ''}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary">
          {labels.apply}
        </Button>
        {/* A link rather than a reset button: `type="reset"` would clear the
            inputs without navigating, leaving the controls empty and the
            table still filtered. */}
        <Button href={basePath} variant="ghost">
          {labels.reset}
        </Button>
      </div>
    </div>

    <p className="max-w-prose text-body-sm text-ink-muted">
      {labels.noResultFilterNote}
    </p>
  </form>
)
