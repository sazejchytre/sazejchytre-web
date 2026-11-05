import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { OPERATOR_DETAILS_CONFIRMED } from './operator.ts'
import { operatorForDisplay } from './operator-display.ts'

/**
 * The production refusal, asserted.
 *
 * This is the guard that stops a live commercial site publishing a `TODO:`
 * IČO — or, worse, an invented one. A guard nobody tests is a guard that gets
 * "simplified" into a fallback value the first time it inconveniences
 * somebody, so both branches are checked here.
 */

describe('operatorForDisplay', () => {
  it('REFUSES in production while any field is a placeholder', () => {
    assert.throws(
      () => operatorForDisplay(true),
      /Operator identity is not configured/,
    )
  })

  it('names the unresolved fields in the refusal', () => {
    // So the message says what to fill in rather than only that something is
    // missing.
    assert.throws(() => operatorForDisplay(true), /name/)
  })

  it('renders the placeholders outside production, marked as placeholders', () => {
    const display = operatorForDisplay(false)

    assert.equal(display.configured, false)
    assert.ok(display.unresolved.length > 0)
    // Visible, so a developer can see what is missing in the footer.
    assert.match(display.operator.name, /^TODO:/)
  })

  it('reports every placeholder field, not just the first', () => {
    const display = operatorForDisplay(false)

    for (const field of ['name', 'street', 'city', 'postalCode', 'ico']) {
      assert.ok(
        display.unresolved.includes(field),
        `${field} is not reported as unresolved`,
      )
    }
  })

  it('builds a one-line address from the parts', () => {
    const display = operatorForDisplay(false)

    assert.equal(
      display.addressLine,
      `${display.operator.street}, ${display.operator.postalCode} ${display.operator.city}`,
    )
  })

  it('exposes no date of birth or personal identifier', () => {
    // The privacy rule from step 1, enforced rather than remembered: a sole
    // trader's business address and IČO are public register data; a date of
    // birth or a rodné číslo is not, and must never be stored or rendered.
    const keys = Object.keys(operatorForDisplay(false).operator)

    for (const forbidden of [
      'dateOfBirth',
      'birthDate',
      'rodneCislo',
      'birthNumber',
      'nationalId',
      'personalId',
    ]) {
      assert.equal(
        keys.includes(forbidden),
        false,
        `operator.ts must never carry ${forbidden}`,
      )
    }
  })

  /**
   * The confirmation flag still being false is what makes the two tests above
   * meaningful. When the real register data lands, this test fails — which is
   * the prompt to invert the expectations rather than to delete the guard.
   */
  it('still has OPERATOR_DETAILS_CONFIRMED false, as of this step', () => {
    assert.equal(
      OPERATOR_DETAILS_CONFIRMED,
      false,
      'Operator details are now confirmed. Update the expectations in this ' +
        'file: operatorForDisplay(true) should no longer throw, and ' +
        'configured should be true. Do NOT delete the refusal itself.',
    )
  })
})
