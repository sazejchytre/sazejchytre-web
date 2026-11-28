import assert from 'node:assert/strict'
import type pg from 'pg'

// Include foreign-key triggers in the snapshot as well as the domain triggers.
export async function readProtectedTriggers(client: pg.Client) {
  const { rows } = await client.query<{
    relation: string
    name: string
    state: string
  }>(`
    SELECT c.relname AS relation, t.tgname AS name, t.tgenabled AS state
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'auth')
     ORDER BY n.nspname, c.relname, t.tgname
  `)
  const names = new Set(rows.map((row) => row.name))
  for (const required of [
    'tips_immutable_after_publication',
    'tips_no_delete_after_publication',
    'tip_selections_immutable_after_publication',
    'tip_selections_no_insert_after_publication',
    'tip_selections_no_delete_after_publication',
    'tip_audit_events_no_update',
    'tip_audit_events_no_delete',
    // Published-record invariants (SC-023).
    'tips_insert_as_draft',
    'tips_no_truncate',
    'tip_selections_no_truncate',
    'tip_audit_events_no_truncate',
    'tip_corrections_prepare',
    'tip_corrections_apply',
    'tip_corrections_no_update',
    'tip_corrections_no_delete',
    'tip_corrections_no_truncate',
    'sporting_events_locked_after_publication',
    'sporting_events_no_delete_after_publication',
    'competitions_locked_after_publication',
    'competitions_no_delete_after_publication',
    'sports_locked_after_publication',
    'sports_no_delete_after_publication',
    'credit_notes_total_within_invoice',
  ]) {
    assert.ok(names.has(required), `Missing database protection: ${required}`)
  }
  for (const row of rows) {
    assert.ok(
      ['O', 'A'].includes(row.state),
      `Inactive trigger: ${row.relation}.${row.name}`,
    )
  }
  return rows
}
