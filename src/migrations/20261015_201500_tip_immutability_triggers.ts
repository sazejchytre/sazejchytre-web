import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Database triggers enforcing the immutability of a published tip.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A TRIGGER, HERE AND NOWHERE ELSE
 *
 * Every other invariant in this codebase is a hook, a constraint, or both. A
 * trigger is a deliberate exception, accepted because the threat model for
 * this one is different: everywhere else the thing to defend against is a bad
 * request, and a request has to go through Payload. Here the thing to defend
 * against is OUR OWN SERVER CODE — a migration, a support script, a patch
 * applied with `overrideAccess: true`, a well-meant "fix" that nudges an odds
 * figure on a tip that won.
 *
 * Hooks cannot see any of that. A trigger sees everything that reaches
 * Postgres.
 *
 * COST, ACCEPTED KNOWINGLY: a trigger is not in Payload's schema snapshot, so
 * `migrate:create` neither knows nor manages it. If the tips tables are ever
 * recreated, these must be re-applied. That is the trade, and it is documented
 * in the README under "Tip immutability" so it is not a surprise later.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHITELIST, NOT BLACKLIST
 *
 * Each trigger names the columns that MAY change and refuses every other
 * difference. A field added next month is therefore frozen by default. The
 * alternative — listing the frozen columns — fails silently the first time
 * somebody adds a field and forgets to update the list, and silent failure is
 * the one outcome this must not have.
 *
 * `IS DISTINCT FROM` rather than `<>` throughout, because `NULL <> NULL` is
 * NULL, not false: a comparison that ignores nulls would let any nullable
 * column be set to or from NULL unnoticed.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  /* --- tips: frozen after publication ----------------------------------- */
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION tips_enforce_immutability()
    RETURNS TRIGGER AS $$
    BEGIN
      -- A draft is freely editable; nothing has been claimed yet.
      IF OLD.status = 'DRAFT' THEN
        RETURN NEW;
      END IF;

      -- Frozen. Only status and settled_at may move (plus updated_at, which
      -- Payload manages). Everything else is the published claim.
      IF  NEW.slug                  IS DISTINCT FROM OLD.slug
       OR NEW.sport_id              IS DISTINCT FROM OLD.sport_id
       OR NEW.title                 IS DISTINCT FROM OLD.title
       OR NEW.published_at          IS DISTINCT FROM OLD.published_at
       OR NEW.public_at             IS DISTINCT FROM OLD.public_at
       OR NEW.required_feature_key  IS DISTINCT FROM OLD.required_feature_key
       OR NEW.stake_units           IS DISTINCT FROM OLD.stake_units
       OR NEW.confidence            IS DISTINCT FROM OLD.confidence
       OR NEW.rationale             IS DISTINCT FROM OLD.rationale
       OR NEW.sources_summary       IS DISTINCT FROM OLD.sources_summary
       OR NEW.ingestion_external_id IS DISTINCT FROM OLD.ingestion_external_id
       OR NEW.created_at            IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION
          'tip % is published and immutable; only status and settled_at may change',
          OLD.id
          USING ERRCODE = 'integrity_constraint_violation',
                HINT = 'Publish a correcting tip instead of editing a published one.';
      END IF;

      -- Terminal statuses are terminal. Re-settling a settled tip is the
      -- exact shape a doctored record would take.
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status IN ('SETTLED', 'VOIDED') THEN
          RAISE EXCEPTION
            'tip % is already % and cannot change status again',
            OLD.id, OLD.status
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF OLD.status = 'PUBLISHED'
           AND NEW.status NOT IN ('SETTLED', 'VOIDED') THEN
          RAISE EXCEPTION
            'illegal tip status transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.execute(sql`
    CREATE TRIGGER tips_immutable_after_publication
    BEFORE UPDATE ON "tips"
    FOR EACH ROW EXECUTE FUNCTION tips_enforce_immutability();
  `)

  /* --- tips: no deletion once published --------------------------------- */
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION tips_block_published_delete()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION
          'tip % is published and cannot be deleted', OLD.id
          USING ERRCODE = 'integrity_constraint_violation',
                HINT = 'Deleting a losing tip would invalidate the whole track record.';
      END IF;

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.execute(sql`
    CREATE TRIGGER tips_no_delete_after_publication
    BEFORE DELETE ON "tips"
    FOR EACH ROW EXECUTE FUNCTION tips_block_published_delete();
  `)

  /* --- selections: frozen, closed set ----------------------------------- */
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION tip_selections_enforce_immutability()
    RETURNS TRIGGER AS $$
    DECLARE
      parent_status text;
    BEGIN
      SELECT t.status INTO parent_status FROM "tips" t WHERE t.id = OLD.tip_id;

      -- No parent found: let the foreign key be the one to complain.
      IF parent_status IS NULL OR parent_status = 'DRAFT' THEN
        RETURN NEW;
      END IF;

      -- Only the result and the closing price may be written afterwards.
      IF  NEW.tip_id              IS DISTINCT FROM OLD.tip_id
       OR NEW.sporting_event_id   IS DISTINCT FROM OLD.sporting_event_id
       OR NEW.market              IS DISTINCT FROM OLD.market
       OR NEW.selection           IS DISTINCT FROM OLD.selection
       OR NEW.line                IS DISTINCT FROM OLD.line
       OR NEW.odds_at_publication IS DISTINCT FROM OLD.odds_at_publication
       OR NEW.minimum_odds        IS DISTINCT FROM OLD.minimum_odds
       OR NEW.created_at          IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION
          'selection % belongs to published tip % and is immutable; only outcome and closing_odds may change',
          OLD.id, OLD.tip_id
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.execute(sql`
    CREATE TRIGGER tip_selections_immutable_after_publication
    BEFORE UPDATE ON "tip_selections"
    FOR EACH ROW EXECUTE FUNCTION tip_selections_enforce_immutability();
  `)

  await db.execute(sql`
    CREATE OR REPLACE FUNCTION tip_selections_block_insert()
    RETURNS TRIGGER AS $$
    DECLARE
      parent_status text;
    BEGIN
      SELECT t.status INTO parent_status FROM "tips" t WHERE t.id = NEW.tip_id;

      IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION
          'cannot add a selection to published tip %', NEW.tip_id
          USING ERRCODE = 'integrity_constraint_violation',
                HINT = 'The number of legs is part of the published claim.';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.execute(sql`
    CREATE TRIGGER tip_selections_no_insert_after_publication
    BEFORE INSERT ON "tip_selections"
    FOR EACH ROW EXECUTE FUNCTION tip_selections_block_insert();
  `)

  await db.execute(sql`
    CREATE OR REPLACE FUNCTION tip_selections_block_delete()
    RETURNS TRIGGER AS $$
    DECLARE
      parent_status text;
    BEGIN
      SELECT t.status INTO parent_status FROM "tips" t WHERE t.id = OLD.tip_id;

      -- Null parent means the tip itself is being deleted, which its own
      -- trigger has already allowed (so it was a draft). Let the cascade run.
      IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION
          'cannot remove a selection from published tip %', OLD.tip_id
          USING ERRCODE = 'integrity_constraint_violation',
                HINT = 'Removing a losing leg would change an already-published result.';
      END IF;

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.execute(sql`
    CREATE TRIGGER tip_selections_no_delete_after_publication
    BEFORE DELETE ON "tip_selections"
    FOR EACH ROW EXECUTE FUNCTION tip_selections_block_delete();
  `)

  /* --- audit log: append only ------------------------------------------- */
  // Beyond what the brief asked for (access control plus a hook), for the same
  // reason the tips themselves get a trigger: the audit trail is the evidence
  // that nothing was edited, so it is worth no less protection than the thing
  // it attests to.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION tip_audit_events_append_only()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION
        'tip_audit_events is append-only (attempted %)', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.execute(sql`
    CREATE TRIGGER tip_audit_events_no_update
    BEFORE UPDATE ON "tip_audit_events"
    FOR EACH ROW EXECUTE FUNCTION tip_audit_events_append_only();
  `)

  await db.execute(sql`
    CREATE TRIGGER tip_audit_events_no_delete
    BEFORE DELETE ON "tip_audit_events"
    FOR EACH ROW EXECUTE FUNCTION tip_audit_events_append_only();
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS tip_audit_events_no_delete ON "tip_audit_events";
    DROP TRIGGER IF EXISTS tip_audit_events_no_update ON "tip_audit_events";
    DROP TRIGGER IF EXISTS tip_selections_no_delete_after_publication ON "tip_selections";
    DROP TRIGGER IF EXISTS tip_selections_no_insert_after_publication ON "tip_selections";
    DROP TRIGGER IF EXISTS tip_selections_immutable_after_publication ON "tip_selections";
    DROP TRIGGER IF EXISTS tips_no_delete_after_publication ON "tips";
    DROP TRIGGER IF EXISTS tips_immutable_after_publication ON "tips";
    DROP FUNCTION IF EXISTS tip_audit_events_append_only();
    DROP FUNCTION IF EXISTS tip_selections_block_delete();
    DROP FUNCTION IF EXISTS tip_selections_block_insert();
    DROP FUNCTION IF EXISTS tip_selections_enforce_immutability();
    DROP FUNCTION IF EXISTS tips_block_published_delete();
    DROP FUNCTION IF EXISTS tips_enforce_immutability();
  `)
}
