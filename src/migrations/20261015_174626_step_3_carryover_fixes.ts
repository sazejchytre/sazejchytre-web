import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Step 3 carry-over fixes from step 2.
 *
 * 1. `invoices.tax_rate_percent` becomes `tax_rate_basis_points`.
 *
 *    Done as a RENAME, not add-and-drop. The column type, default and
 *    nullability are identical, so a rename produces exactly the right end
 *    state and keeps the column's position and dependencies.
 *
 *    NOTE ON VALUES: the unit changes with the name — 21 meant 21% and now
 *    means 0.21%. `invoices` is empty (verified before this ran), so there is
 *    nothing to reinterpret. Against a table with rows this migration would
 *    have to be: add the new column, `UPDATE … SET new = old * 100`, then drop
 *    the old one. Do not reuse this as a template on populated data.
 *
 * 2. `invoices.subscription_id` becomes nullable, for one-off charges.
 *
 * 3. The webhook idempotency key widens from `external_event_id` alone to
 *    (provider, external_event_id). An event id is only unique within the
 *    provider that issued it; the old key would let a second provider's event
 *    be silently swallowed as a duplicate. The single-column index is kept,
 *    non-unique, because lookups by event id alone are still useful.
 *
 * 4. Four row-local invariants that were hook-only become CHECK constraints,
 *    so they also hold for a migration, a support script or a psql session.
 *    The hooks stay — they turn a 23514 into a readable sentence.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "invoices" RENAME COLUMN "tax_rate_percent" TO "tax_rate_basis_points";
  ALTER TABLE "invoices" ALTER COLUMN "subscription_id" DROP NOT NULL;
  DROP INDEX "webhook_events_external_event_id_idx";
  CREATE UNIQUE INDEX "provider_externalEventId_idx" ON "webhook_events" USING btree ("provider","external_event_id");
  CREATE INDEX "webhook_events_external_event_id_idx" ON "webhook_events" USING btree ("external_event_id");
  ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_ordered" CHECK ("subscriptions"."current_period_end" >= "subscriptions"."current_period_start");
  ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_exactly_one_target" CHECK (("entitlement_grants"."feature_key" IS NULL) <> ("entitlement_grants"."plan_id" IS NULL));
  ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_window_ordered" CHECK ("entitlement_grants"."ends_at" IS NULL OR "entitlement_grants"."ends_at" >= "entitlement_grants"."starts_at");
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_totals_add_up" CHECK ("invoices"."subtotal_minor" + "invoices"."tax_minor" = "invoices"."total_minor");
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_no_vat_when_not_registered" CHECK ("invoices"."tax_treatment" <> 'NONE_NOT_VAT_REGISTERED'
              OR ("invoices"."tax_minor" = 0 AND "invoices"."tax_rate_basis_points" = 0));
  ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_withdrawal_ordered" CHECK ("consent_records"."withdrawn_at" IS NULL OR "consent_records"."withdrawn_at" >= "consent_records"."granted_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "consent_records" DROP CONSTRAINT "consent_records_withdrawal_ordered";
  ALTER TABLE "invoices" DROP CONSTRAINT "invoices_no_vat_when_not_registered";
  ALTER TABLE "invoices" DROP CONSTRAINT "invoices_totals_add_up";
  ALTER TABLE "entitlement_grants" DROP CONSTRAINT "entitlement_grants_window_ordered";
  ALTER TABLE "entitlement_grants" DROP CONSTRAINT "entitlement_grants_exactly_one_target";
  ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_period_ordered";
  DROP INDEX "provider_externalEventId_idx";
  DROP INDEX "webhook_events_external_event_id_idx";
  CREATE UNIQUE INDEX "webhook_events_external_event_id_idx" ON "webhook_events" USING btree ("external_event_id");
  ALTER TABLE "invoices" ALTER COLUMN "subscription_id" SET NOT NULL;
  ALTER TABLE "invoices" RENAME COLUMN "tax_rate_basis_points" TO "tax_rate_percent";`)
}
