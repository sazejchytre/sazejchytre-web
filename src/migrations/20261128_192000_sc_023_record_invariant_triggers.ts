import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Completes the database guarantee that a published tip does not change.
 *
 * Builds on `20261015_201500_tip_immutability_triggers`, which stays as it was
 * committed. The functions it created are REPLACED here, under the same names,
 * so the triggers it attached keep firing and now run the rules below. `down`
 * puts the original function bodies back.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS ADDS
 *
 *  1. TRUE WHITELISTS. Each frozen row is compared as a whole (`to_jsonb`)
 *     minus the columns that may move, so a column added later is frozen by
 *     default and nothing (an id, a seed marker) is left out by omission.
 *
 *  2. BOTH PARENTS. A selection update locks and checks the tip it leaves AND
 *     the tip it would join. A published tip's set of legs is closed in both
 *     directions.
 *
 *  3. ONE LOCK ORDER. Every writer of a selection takes the parent tip row
 *     with FOR NO KEY UPDATE, the same lock the publishing UPDATE holds. So a
 *     selection write and a publication of the same tip never interleave:
 *     whichever comes second waits and then sees the other's committed result.
 *     Publication then locks the referenced events, competitions and sports,
 *     always in that order and by id, so two publications cannot deadlock on
 *     shared rows.
 *
 *  4. THE MEANING OF THE TIP IS FROZEN WITH IT. The public record reads the
 *     fixture, its kick-off, its competition and the sport from those rows.
 *     Publication stamps `record_locked_at` on each of them, in the same
 *     transaction; from then on their identifying fields are frozen and the
 *     rows cannot be deleted. The stamp is a real write, so a concurrent
 *     editor either waits for it and is refused, or (under REPEATABLE READ or
 *     SERIALIZABLE) fails with a serialization error.
 *
 *     Chosen over a snapshot table because the public pages read these rows
 *     directly: a frozen copy nobody reads would leave the displayed record
 *     editable, and a second copy of the same facts is two answers to one
 *     question.
 *
 *  5. PUBLICATION IS A CHECKED TRANSITION. A tip is inserted as DRAFT, goes
 *     DRAFT → PUBLISHED only, needs `published_at` and at least one
 *     selection, and must be published at READ COMMITTED: the locking above
 *     relies on each statement seeing what committed before its lock was
 *     granted, which a transaction-wide snapshot does not.
 *
 *  6. ONE-WAY SETTLEMENT. On a PUBLISHED tip an outcome moves only from
 *     PENDING to a decided value, and a closing price and `settled_at` only
 *     from empty to a value. On a SETTLED or VOIDED tip nothing moves. A tip
 *     becomes SETTLED only with every leg decided and `settled_at` set, which
 *     is written once, with the final status.
 *
 *  7. RECORDED CORRECTIONS. Any other change to a result must match the
 *     latest `tip_corrections` row for that selection in the SAME transaction.
 *     Inserting that row applies the change, so the record and the change are
 *     one statement. The table is append-only and cannot be truncated.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EXISTING DATA
 *
 * Rows that published tips already depend on are stamped with the time this
 * migration runs. That is when the lock started, not when the tip was
 * published: the values those rows held at publication were never recorded,
 * so they are not reconstructed here. The counts logged below tell the
 * operator whether anything needs a human look; nothing is changed to make
 * old rows fit the new rules.
 */

const REFUSE = `USING ERRCODE = 'integrity_constraint_violation'`

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  // Nothing may publish, settle or move a selection while the rules change.
  await db.execute(sql`
    LOCK TABLE "sports", "competitions", "sporting_events", "tips",
               "tip_selections", "tip_audit_events", "tip_corrections"
      IN SHARE ROW EXCLUSIVE MODE;
  `)

  /* --- tips -------------------------------------------------------------- */
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tips_enforce_immutability()
    RETURNS TRIGGER AS $$
    DECLARE
      changed text[];
      leg_count integer;
      pending_count integer;
    BEGIN
      IF OLD.status = 'DRAFT' THEN
        -- A draft is freely editable; nothing has been claimed yet.
        IF NEW.status = 'DRAFT' THEN
          RETURN NEW;
        END IF;

        IF NEW.status <> 'PUBLISHED' THEN
          RAISE EXCEPTION 'illegal tip status transition % -> %',
            OLD.status, NEW.status ${REFUSE};
        END IF;

        -- The locks below rely on every statement seeing what committed
        -- before its lock was granted. A transaction snapshot does not.
        IF current_setting('transaction_isolation') <> 'read committed' THEN
          RAISE EXCEPTION
            'tip % must be published at READ COMMITTED isolation, not %',
            OLD.id, current_setting('transaction_isolation') ${REFUSE};
        END IF;

        IF NEW.published_at IS NULL THEN
          RAISE EXCEPTION 'tip % cannot be published without published_at',
            OLD.id ${REFUSE};
        END IF;

        -- This UPDATE holds the tip row, and every selection writer takes the
        -- same row lock first, so the set of selections read here is final.
        SELECT count(*) INTO leg_count
          FROM "tip_selections" s WHERE s.tip_id = NEW.id;

        IF leg_count = 0 THEN
          RAISE EXCEPTION 'tip % cannot be published without a selection',
            OLD.id ${REFUSE};
        END IF;

        -- Freeze what the tip refers to. Locked in one global order (events,
        -- competitions, sports; each by id) so concurrent publications that
        -- share rows queue instead of deadlocking.
        PERFORM 1 FROM "sporting_events" e
          WHERE e.id IN (SELECT s.sporting_event_id FROM "tip_selections" s
                          WHERE s.tip_id = NEW.id)
          ORDER BY e.id FOR NO KEY UPDATE;

        UPDATE "sporting_events" e SET record_locked_at = now()
          WHERE e.record_locked_at IS NULL
            AND e.id IN (SELECT s.sporting_event_id FROM "tip_selections" s
                          WHERE s.tip_id = NEW.id);

        PERFORM 1 FROM "competitions" c
          WHERE c.id IN (SELECT e.competition_id FROM "sporting_events" e
                           JOIN "tip_selections" s ON s.sporting_event_id = e.id
                          WHERE s.tip_id = NEW.id)
          ORDER BY c.id FOR NO KEY UPDATE;

        UPDATE "competitions" c SET record_locked_at = now()
          WHERE c.record_locked_at IS NULL
            AND c.id IN (SELECT e.competition_id FROM "sporting_events" e
                           JOIN "tip_selections" s ON s.sporting_event_id = e.id
                          WHERE s.tip_id = NEW.id);

        PERFORM 1 FROM "sports" sp
          WHERE sp.id = NEW.sport_id
             OR sp.id IN (SELECT c.sport_id FROM "competitions" c
                            JOIN "sporting_events" e ON e.competition_id = c.id
                            JOIN "tip_selections" s ON s.sporting_event_id = e.id
                           WHERE s.tip_id = NEW.id)
          ORDER BY sp.id FOR NO KEY UPDATE;

        UPDATE "sports" sp SET record_locked_at = now()
          WHERE sp.record_locked_at IS NULL
            AND (sp.id = NEW.sport_id
                 OR sp.id IN (SELECT c.sport_id FROM "competitions" c
                                JOIN "sporting_events" e ON e.competition_id = c.id
                                JOIN "tip_selections" s ON s.sporting_event_id = e.id
                               WHERE s.tip_id = NEW.id));

        RETURN NEW;
      END IF;

      -- Frozen. Only status, settled_at (with the final status) and Payload's
      -- updated_at may differ. Compared as whole rows, so a column added
      -- later is frozen without anyone remembering to list it.
      SELECT array_agg(o.key ORDER BY o.key) INTO changed
        FROM jsonb_each(to_jsonb(OLD)) o
        JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
       WHERE o.key NOT IN ('status', 'settled_at', 'updated_at')
         AND o.value IS DISTINCT FROM n.value;

      IF changed IS NOT NULL THEN
        RAISE EXCEPTION
          'tip % is published and immutable; only status and settled_at may change (attempted: %)',
          OLD.id, array_to_string(changed, ', ')
          ${REFUSE},
                HINT = 'Publish a correcting tip instead of editing a published one.';
      END IF;

      IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- Terminal statuses are terminal.
        IF OLD.status IN ('SETTLED', 'VOIDED') THEN
          RAISE EXCEPTION
            'tip % is already % and cannot change status again',
            OLD.id, OLD.status ${REFUSE};
        END IF;

        IF NEW.status NOT IN ('SETTLED', 'VOIDED') THEN
          RAISE EXCEPTION 'illegal tip status transition % -> %',
            OLD.status, NEW.status ${REFUSE};
        END IF;

        IF NEW.status = 'SETTLED' THEN
          IF NEW.settled_at IS NULL THEN
            RAISE EXCEPTION 'tip % cannot be SETTLED without settled_at',
              OLD.id ${REFUSE};
          END IF;

          -- Selection writers hold this row while they work, so no leg can
          -- change between this count and the commit.
          SELECT count(*), count(*) FILTER (WHERE s.outcome = 'PENDING')
            INTO leg_count, pending_count
            FROM "tip_selections" s WHERE s.tip_id = OLD.id;

          IF leg_count = 0 OR pending_count > 0 THEN
            RAISE EXCEPTION
              'tip % cannot be SETTLED while % of % selections are pending',
              OLD.id, pending_count, leg_count ${REFUSE};
          END IF;
        END IF;
      ELSIF NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
        RAISE EXCEPTION
          'tip %: settled_at is written once, together with the final status',
          OLD.id ${REFUSE};
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tips_insert_as_draft()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status <> 'DRAFT' THEN
        RAISE EXCEPTION
          'a tip is created as DRAFT and published by a separate update (got %)',
          NEW.status ${REFUSE};
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  await db.execute(sql`
    CREATE TRIGGER tips_insert_as_draft
    BEFORE INSERT ON "tips"
    FOR EACH ROW EXECUTE FUNCTION tips_insert_as_draft();
  `)

  /* --- selections -------------------------------------------------------- */
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tip_selections_enforce_immutability()
    RETURNS TRIGGER AS $$
    DECLARE
      parent record;
      old_status text;
      new_status text;
      changed text[];
      correction record;
    BEGIN
      -- Lock both parents, in id order. The same row lock the publishing
      -- UPDATE takes, so this write and a publication never interleave.
      FOR parent IN
        SELECT t.id, t.status::text AS status FROM "tips" t
         WHERE t.id IN (OLD.tip_id, NEW.tip_id)
         ORDER BY t.id FOR NO KEY UPDATE
      LOOP
        IF parent.id = OLD.tip_id THEN old_status := parent.status; END IF;
        IF parent.id = NEW.tip_id THEN new_status := parent.status; END IF;
      END LOOP;

      -- A missing parent is the foreign key's to report.
      IF COALESCE(old_status, 'DRAFT') = 'DRAFT'
         AND COALESCE(new_status, 'DRAFT') = 'DRAFT' THEN
        RETURN NEW;
      END IF;

      IF NEW.tip_id IS DISTINCT FROM OLD.tip_id THEN
        RAISE EXCEPTION
          'selection % cannot move from tip % (%) to tip % (%): a published tip''s set of selections is closed',
          OLD.id, OLD.tip_id, COALESCE(old_status, 'missing'),
          NEW.tip_id, COALESCE(new_status, 'missing') ${REFUSE};
      END IF;

      -- The pick itself. Whole-row comparison minus the result columns.
      SELECT array_agg(o.key ORDER BY o.key) INTO changed
        FROM jsonb_each(to_jsonb(OLD)) o
        JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
       WHERE o.key NOT IN ('outcome', 'closing_odds', 'settled_at', 'updated_at')
         AND o.value IS DISTINCT FROM n.value;

      IF changed IS NOT NULL THEN
        RAISE EXCEPTION
          'selection % belongs to published tip % and is immutable; only outcome and closing_odds may change (attempted: %)',
          OLD.id, OLD.tip_id, array_to_string(changed, ', ') ${REFUSE};
      END IF;

      IF NEW.outcome IS NOT DISTINCT FROM OLD.outcome
         AND NEW.closing_odds IS NOT DISTINCT FROM OLD.closing_odds
         AND NEW.settled_at IS NOT DISTINCT FROM OLD.settled_at THEN
        RETURN NEW;
      END IF;

      -- A recorded correction: the change must be exactly the latest one
      -- recorded for this selection in this transaction. Once applied, the
      -- row no longer matches its "previous" side, so it cannot be replayed.
      SELECT c.previous_outcome::text AS previous_outcome,
             c.new_outcome::text AS new_outcome,
             c.previous_closing_odds, c.new_closing_odds
        INTO correction
        FROM "tip_corrections" c
       WHERE c.selection_id = OLD.id
         AND c.transaction_id = pg_current_xact_id()::text
       ORDER BY c.id DESC
       LIMIT 1;

      IF FOUND
         AND correction.previous_outcome = OLD.outcome::text
         AND correction.new_outcome = NEW.outcome::text
         AND correction.previous_closing_odds IS NOT DISTINCT FROM OLD.closing_odds
         AND correction.new_closing_odds IS NOT DISTINCT FROM NEW.closing_odds
         AND NEW.settled_at IS NOT DISTINCT FROM OLD.settled_at THEN
        RETURN NEW;
      END IF;

      -- Ordinary settlement: one way, and only while the tip is open.
      IF old_status <> 'PUBLISHED' THEN
        RAISE EXCEPTION
          'selection % of % tip % has a final result; record a correction in tip_corrections to change it',
          OLD.id, old_status, OLD.tip_id ${REFUSE};
      END IF;

      IF NEW.outcome IS DISTINCT FROM OLD.outcome
         AND NOT (OLD.outcome = 'PENDING' AND NEW.outcome <> 'PENDING') THEN
        RAISE EXCEPTION
          'selection % already has outcome %; a decided result changes only through a recorded correction',
          OLD.id, OLD.outcome ${REFUSE};
      END IF;

      IF NEW.closing_odds IS DISTINCT FROM OLD.closing_odds
         AND OLD.closing_odds IS NOT NULL THEN
        RAISE EXCEPTION
          'selection % already has a closing price; it changes only through a recorded correction',
          OLD.id ${REFUSE};
      END IF;

      IF NEW.settled_at IS DISTINCT FROM OLD.settled_at
         AND OLD.settled_at IS NOT NULL THEN
        RAISE EXCEPTION 'selection %: settled_at is written once', OLD.id ${REFUSE};
      END IF;

      IF NEW.settled_at IS NOT NULL AND NEW.outcome = 'PENDING' THEN
        RAISE EXCEPTION
          'selection %: settled_at belongs to a decided outcome', OLD.id ${REFUSE};
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tip_selections_block_insert()
    RETURNS TRIGGER AS $$
    DECLARE
      parent_status text;
    BEGIN
      SELECT t.status INTO parent_status FROM "tips" t
       WHERE t.id = NEW.tip_id FOR NO KEY UPDATE;

      IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION
          'cannot add a selection to published tip %', NEW.tip_id
          ${REFUSE},
                HINT = 'The number of legs is part of the published claim.';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tip_selections_block_delete()
    RETURNS TRIGGER AS $$
    DECLARE
      parent_status text;
    BEGIN
      SELECT t.status INTO parent_status FROM "tips" t
       WHERE t.id = OLD.tip_id FOR NO KEY UPDATE;

      -- Null parent means the tip itself is being deleted, which its own
      -- trigger has already allowed (so it was a draft).
      IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION
          'cannot remove a selection from published tip %', OLD.tip_id
          ${REFUSE},
                HINT = 'Removing a losing leg would change an already-published result.';
      END IF;

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  /* --- events, competitions, sports -------------------------------------- */
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION record_reference_enforce_lock()
    RETURNS TRIGGER AS $$
    DECLARE
      changed text[];
    BEGIN
      IF OLD.record_locked_at IS NULL THEN
        -- Locking is one-way and stamped with the database clock.
        IF NEW.record_locked_at IS NOT NULL THEN
          NEW.record_locked_at := now();
        END IF;

        RETURN NEW;
      END IF;

      -- TG_ARGV names the columns that may still change. The stamp itself
      -- and everything else are frozen.
      SELECT array_agg(o.key ORDER BY o.key) INTO changed
        FROM jsonb_each(to_jsonb(OLD)) o
        JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
       WHERE o.key <> ALL (TG_ARGV)
         AND o.key <> 'updated_at'
         AND o.value IS DISTINCT FROM n.value;

      IF changed IS NOT NULL THEN
        RAISE EXCEPTION
          '% % is part of the published record and immutable (attempted: %)',
          TG_TABLE_NAME, OLD.id, array_to_string(changed, ', ')
          ${REFUSE},
                HINT = 'A published tip depends on this row.';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION record_reference_block_delete()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.record_locked_at IS NOT NULL THEN
        RAISE EXCEPTION
          '% % is part of the published record and cannot be deleted',
          TG_TABLE_NAME, OLD.id ${REFUSE};
      END IF;

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  /* --- corrections ------------------------------------------------------- */
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tip_corrections_prepare()
    RETURNS TRIGGER AS $$
    DECLARE
      leg record;
      parent_status text;
    BEGIN
      -- Same lock order as an ordinary selection update: the selection row,
      -- then its tip.
      SELECT s.id, s.tip_id, s.outcome::text AS outcome, s.closing_odds
        INTO leg
        FROM "tip_selections" s
       WHERE s.id = NEW.selection_id
         FOR NO KEY UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'correction refers to unknown selection %',
          NEW.selection_id ${REFUSE};
      END IF;

      SELECT t.status INTO parent_status FROM "tips" t
       WHERE t.id = leg.tip_id FOR NO KEY UPDATE;

      IF parent_status = 'DRAFT' THEN
        RAISE EXCEPTION
          'selection % belongs to a draft; edit the draft instead of recording a correction',
          leg.id ${REFUSE};
      END IF;

      IF NEW.tip_id IS DISTINCT FROM leg.tip_id THEN
        RAISE EXCEPTION
          'correction names tip % but selection % belongs to tip %',
          NEW.tip_id, leg.id, leg.tip_id ${REFUSE};
      END IF;

      -- The previous value is read here, never taken from the caller.
      NEW.previous_outcome := leg.outcome::enum_tip_corrections_previous_outcome;
      NEW.previous_closing_odds := leg.closing_odds;

      -- An empty new closing price means "unchanged".
      IF NEW.new_closing_odds IS NULL THEN
        NEW.new_closing_odds := leg.closing_odds;
      END IF;

      IF (leg.outcome = 'PENDING') <> (NEW.new_outcome::text = 'PENDING') THEN
        RAISE EXCEPTION
          'a correction cannot settle a pending selection or return a decided one to PENDING (selection %: % -> %)',
          leg.id, leg.outcome, NEW.new_outcome ${REFUSE};
      END IF;

      IF NEW.new_outcome::text = leg.outcome
         AND NEW.new_closing_odds IS NOT DISTINCT FROM leg.closing_odds THEN
        RAISE EXCEPTION 'correction of selection % changes nothing', leg.id ${REFUSE};
      END IF;

      IF NEW.new_closing_odds IS NOT NULL
         AND (NEW.new_closing_odds < 1001 OR NEW.new_closing_odds > 1000000) THEN
        RAISE EXCEPTION 'correction of selection %: closing odds % out of range',
          leg.id, NEW.new_closing_odds ${REFUSE};
      END IF;

      IF NEW.reason IS NULL OR char_length(btrim(NEW.reason)) < 10 THEN
        RAISE EXCEPTION 'a correction needs a reason of at least 10 characters'
          ${REFUSE};
      END IF;

      IF NEW.actor IS NULL OR btrim(NEW.actor) = '' THEN
        RAISE EXCEPTION 'a correction needs an author' ${REFUSE};
      END IF;

      -- Attribution the caller cannot choose.
      NEW.recorded_at := now();
      NEW.database_role := session_user;
      NEW.transaction_id := pg_current_xact_id()::text;
      NEW.created_at := now();
      NEW.updated_at := now();

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  // AFTER INSERT, so the selection trigger can see the row it must match.
  // The insert and the change are one statement: neither exists alone.
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tip_corrections_apply()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE "tip_selections"
         SET outcome = NEW.new_outcome::text::enum_tip_selections_outcome,
             closing_odds = NEW.new_closing_odds,
             updated_at = now()
       WHERE id = NEW.selection_id;

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tip_corrections_append_only()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'tip_corrections is append-only (attempted %)', TG_OP
        ${REFUSE};
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  // One statement-level guard for TRUNCATE on every table of the record. It
  // also fires for each table reached by TRUNCATE ... CASCADE.
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION tip_record_block_truncate()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '% is part of the published record and cannot be truncated',
        TG_TABLE_NAME ${REFUSE};
    END;
    $$ LANGUAGE plpgsql;
  `),
  )

  /* --- existing data ----------------------------------------------------- */
  // Before the reference triggers exist, so this is a plain write. Stamped
  // with now(): the lock starts today, and no earlier value is invented.
  await db.execute(sql`
    UPDATE "sporting_events" e SET record_locked_at = now()
     WHERE e.record_locked_at IS NULL
       AND EXISTS (SELECT 1 FROM "tip_selections" s
                     JOIN "tips" t ON t.id = s.tip_id
                    WHERE s.sporting_event_id = e.id AND t.status <> 'DRAFT');
  `)
  await db.execute(sql`
    UPDATE "competitions" c SET record_locked_at = now()
     WHERE c.record_locked_at IS NULL
       AND EXISTS (SELECT 1 FROM "sporting_events" e
                    WHERE e.competition_id = c.id
                      AND e.record_locked_at IS NOT NULL);
  `)
  await db.execute(sql`
    UPDATE "sports" sp SET record_locked_at = now()
     WHERE sp.record_locked_at IS NULL
       AND (EXISTS (SELECT 1 FROM "tips" t
                     WHERE t.sport_id = sp.id AND t.status <> 'DRAFT')
            OR EXISTS (SELECT 1 FROM "competitions" c
                        WHERE c.sport_id = sp.id
                          AND c.record_locked_at IS NOT NULL));
  `)

  /* --- triggers ---------------------------------------------------------- */
  await db.execute(sql`
    CREATE TRIGGER sporting_events_locked_after_publication
    BEFORE UPDATE ON "sporting_events"
    FOR EACH ROW EXECUTE FUNCTION
      record_reference_enforce_lock('status', 'final_score', 'external_refs');

    CREATE TRIGGER sporting_events_no_delete_after_publication
    BEFORE DELETE ON "sporting_events"
    FOR EACH ROW EXECUTE FUNCTION record_reference_block_delete();

    CREATE TRIGGER competitions_locked_after_publication
    BEFORE UPDATE ON "competitions"
    FOR EACH ROW EXECUTE FUNCTION record_reference_enforce_lock('external_refs');

    CREATE TRIGGER competitions_no_delete_after_publication
    BEFORE DELETE ON "competitions"
    FOR EACH ROW EXECUTE FUNCTION record_reference_block_delete();

    CREATE TRIGGER sports_locked_after_publication
    BEFORE UPDATE ON "sports"
    FOR EACH ROW EXECUTE FUNCTION record_reference_enforce_lock('active', 'sort_order');

    CREATE TRIGGER sports_no_delete_after_publication
    BEFORE DELETE ON "sports"
    FOR EACH ROW EXECUTE FUNCTION record_reference_block_delete();

    CREATE TRIGGER tip_corrections_prepare
    BEFORE INSERT ON "tip_corrections"
    FOR EACH ROW EXECUTE FUNCTION tip_corrections_prepare();

    CREATE TRIGGER tip_corrections_apply
    AFTER INSERT ON "tip_corrections"
    FOR EACH ROW EXECUTE FUNCTION tip_corrections_apply();

    CREATE TRIGGER tip_corrections_no_update
    BEFORE UPDATE ON "tip_corrections"
    FOR EACH ROW EXECUTE FUNCTION tip_corrections_append_only();

    CREATE TRIGGER tip_corrections_no_delete
    BEFORE DELETE ON "tip_corrections"
    FOR EACH ROW EXECUTE FUNCTION tip_corrections_append_only();

    CREATE TRIGGER tips_no_truncate
    BEFORE TRUNCATE ON "tips"
    FOR EACH STATEMENT EXECUTE FUNCTION tip_record_block_truncate();

    CREATE TRIGGER tip_selections_no_truncate
    BEFORE TRUNCATE ON "tip_selections"
    FOR EACH STATEMENT EXECUTE FUNCTION tip_record_block_truncate();

    CREATE TRIGGER tip_audit_events_no_truncate
    BEFORE TRUNCATE ON "tip_audit_events"
    FOR EACH STATEMENT EXECUTE FUNCTION tip_record_block_truncate();

    CREATE TRIGGER tip_corrections_no_truncate
    BEFORE TRUNCATE ON "tip_corrections"
    FOR EACH STATEMENT EXECUTE FUNCTION tip_record_block_truncate();
  `)

  /* --- report what the new rules cannot vouch for ------------------------ */
  const count = async (query: ReturnType<typeof sql>): Promise<number> => {
    const result = (await db.execute(query)) as unknown as {
      rows?: { n?: unknown }[]
    }
    return Number(result.rows?.[0]?.n ?? 0)
  }

  const findings = {
    // Published before this migration with no selection at all.
    publishedWithoutSelections: await count(sql`
      SELECT count(*)::int AS n FROM "tips" t
       WHERE t.status <> 'DRAFT'
         AND NOT EXISTS (SELECT 1 FROM "tip_selections" s WHERE s.tip_id = t.id)
    `),
    // SETTLED although a leg is still pending: the record cannot compute it.
    settledWithPendingSelections: await count(sql`
      SELECT count(DISTINCT t.id)::int AS n FROM "tips" t
        JOIN "tip_selections" s ON s.tip_id = t.id
       WHERE t.status = 'SETTLED' AND s.outcome = 'PENDING'
    `),
    // Events edited after a tip that depends on them was published. What
    // they said at publication is not recoverable from the database.
    eventsEditedAfterPublication: await count(sql`
      SELECT count(DISTINCT e.id)::int AS n FROM "sporting_events" e
        JOIN "tip_selections" s ON s.sporting_event_id = e.id
        JOIN "tips" t ON t.id = s.tip_id
       WHERE t.status <> 'DRAFT' AND t.published_at IS NOT NULL
         AND e.updated_at > t.published_at
    `),
  }

  const message =
    'SC-023 record invariants installed. Pre-existing rows the new rules cannot vouch for: ' +
    JSON.stringify(findings)

  if (Object.values(findings).some((n) => n > 0)) {
    payload.logger.warn(message)
  } else {
    payload.logger.info(message)
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS tip_corrections_no_truncate ON "tip_corrections";
    DROP TRIGGER IF EXISTS tip_audit_events_no_truncate ON "tip_audit_events";
    DROP TRIGGER IF EXISTS tip_selections_no_truncate ON "tip_selections";
    DROP TRIGGER IF EXISTS tips_no_truncate ON "tips";
    DROP TRIGGER IF EXISTS tip_corrections_no_delete ON "tip_corrections";
    DROP TRIGGER IF EXISTS tip_corrections_no_update ON "tip_corrections";
    DROP TRIGGER IF EXISTS tip_corrections_apply ON "tip_corrections";
    DROP TRIGGER IF EXISTS tip_corrections_prepare ON "tip_corrections";
    DROP TRIGGER IF EXISTS sports_no_delete_after_publication ON "sports";
    DROP TRIGGER IF EXISTS sports_locked_after_publication ON "sports";
    DROP TRIGGER IF EXISTS competitions_no_delete_after_publication ON "competitions";
    DROP TRIGGER IF EXISTS competitions_locked_after_publication ON "competitions";
    DROP TRIGGER IF EXISTS sporting_events_no_delete_after_publication ON "sporting_events";
    DROP TRIGGER IF EXISTS sporting_events_locked_after_publication ON "sporting_events";
    DROP TRIGGER IF EXISTS tips_insert_as_draft ON "tips";
    DROP FUNCTION IF EXISTS tip_record_block_truncate();
    DROP FUNCTION IF EXISTS tip_corrections_append_only();
    DROP FUNCTION IF EXISTS tip_corrections_apply();
    DROP FUNCTION IF EXISTS tip_corrections_prepare();
    DROP FUNCTION IF EXISTS record_reference_block_delete();
    DROP FUNCTION IF EXISTS record_reference_enforce_lock();
    DROP FUNCTION IF EXISTS tips_insert_as_draft();
  `)

  // The function bodies of 20261015_201500_tip_immutability_triggers, exactly
  // as committed, so the triggers it created behave as they did before.
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
}
