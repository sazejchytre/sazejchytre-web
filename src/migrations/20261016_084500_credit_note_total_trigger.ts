import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Over-crediting, enforced by the database.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A TRIGGER AND NOT JUST THE APPLICATION CHECK
 *
 * `issueCreditNote` sums the existing credit notes and refuses if the new one
 * would take the total past the invoice. That read-then-write has a window:
 * two refunds arriving at once both read the old sum, both decide there is
 * room, and both insert. Each was individually correct and the pair is not.
 *
 * The consequence is money. Credit notes summing past the invoice total
 * assert a refund larger than the payment, and in a VAT return that
 * understates revenue by the difference. It is also not self-correcting —
 * nothing later notices, because each row looks fine on its own.
 *
 * So the invariant lives where it can actually be guaranteed. The application
 * check stays: it produces a good error message with the numbers in it, which
 * a constraint violation cannot. This is the backstop that makes the rule
 * true rather than merely usually true.
 *
 * A CHECK constraint cannot express it — the rule spans rows — so it is a
 * trigger. That makes this the second trigger in the codebase, after the tip
 * immutability ones; both exist for the same reason, that the invariant is
 * worth more than the tidiness of keeping every rule in Payload.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT LOCKS THE INVOICE ROW
 *
 * `SELECT ... FOR UPDATE` on the invoice serialises concurrent credit notes
 * against the same invoice. Without the lock the trigger has the same race it
 * is meant to close: both transactions would sum before either inserted.
 * Locking the invoice rather than the credit notes is deliberate — the
 * invoice is the single row every competing transaction must pass through.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // SQLSTATE 23000 (integrity constraint violation), consistent with the tip
  // immutability triggers, so one error-code check covers both.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION enforce_credit_note_total()
    RETURNS TRIGGER AS $$
    DECLARE
      invoice_total integer;
      credited_total integer;
    BEGIN
      -- Lock the invoice so competing credit notes serialise here.
      SELECT total_minor INTO invoice_total
      FROM invoices
      WHERE id = NEW.invoice_id
      FOR UPDATE;

      IF invoice_total IS NULL THEN
        RAISE EXCEPTION
          'Credit note references invoice % which does not exist.', NEW.invoice_id
          USING ERRCODE = '23000';
      END IF;

      SELECT COALESCE(SUM(amount_minor), 0) INTO credited_total
      FROM credit_notes
      WHERE invoice_id = NEW.invoice_id
        AND id <> COALESCE(NEW.id, -1);

      IF credited_total + NEW.amount_minor > invoice_total THEN
        RAISE EXCEPTION
          'Credit notes for invoice % would total % which exceeds the invoice total %.',
          NEW.invoice_id, credited_total + NEW.amount_minor, invoice_total
          USING ERRCODE = '23000';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.execute(sql`
    CREATE TRIGGER credit_notes_total_within_invoice
    BEFORE INSERT OR UPDATE ON credit_notes
    FOR EACH ROW
    EXECUTE FUNCTION enforce_credit_note_total();
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql`DROP TRIGGER IF EXISTS credit_notes_total_within_invoice ON credit_notes;`,
  )
  await db.execute(sql`DROP FUNCTION IF EXISTS enforce_credit_note_total();`)
}
