/**
 * The honeypot input.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HIDDEN FROM PEOPLE, NOT FROM BOTS
 *
 * The whole trick is that a script filling in every field it finds in the
 * HTML will fill this one, and a person will not. So it must be present in
 * the DOM, and it must be unreachable by every route a person uses:
 *
 *   - `position: absolute` with `left: -9999px` rather than
 *     `display: none` or `hidden`. A bot author checking for the obvious
 *     "is it hidden" properties skips a `display: none` field; an
 *     off-screen one looks real.
 *   - `tabIndex={-1}` so the Tab key never lands on it. Without this, a
 *     keyboard user tabs into an invisible field, types their message into
 *     nowhere, and is then told their submission looks automated.
 *   - `aria-hidden` so a screen reader never announces it. Same failure as
 *     above, worse: the reader would be invited to fill it in.
 *   - `autoComplete="off"` so a browser does not helpfully put an address in
 *     it. A password manager filling a hidden field called `website` would
 *     block real submissions — which is the failure mode that makes
 *     honeypots look unreliable.
 *
 * The field is called `website`, not `honeypot`. See `schema.ts`.
 */
import { HONEYPOT_FIELD } from '@/lib/forms/schema'

export const HoneypotField = () => (
  <div
    aria-hidden="true"
    style={{
      position: 'absolute',
      left: '-9999px',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
    }}
  >
    <label htmlFor={`${HONEYPOT_FIELD}-field`}>Web</label>
    <input
      id={`${HONEYPOT_FIELD}-field`}
      type="text"
      name={HONEYPOT_FIELD}
      tabIndex={-1}
      autoComplete="off"
      defaultValue=""
    />
  </div>
)
