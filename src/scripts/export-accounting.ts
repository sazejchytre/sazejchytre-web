/**
 * Export issued documents for an accountant.
 *
 *   FROM=2026-01-01 TO=2026-12-31 pnpm export:accounting
 *   FROM=2026-01-01 TO=2026-03-31 OUT=q1.csv pnpm export:accounting
 *
 * Defaults to the current calendar year, which is the range asked for most
 * often. Writes to stdout unless `OUT` names a file, so it pipes.
 *
 * Switches are environment variables rather than `--flags` because
 * `payload run` consumes extra argv — the same reason `APPLY` and
 * `CONFIRM_LIVE` work that way in the price sync.
 */
import { writeFileSync } from 'node:fs'

import { getPayload } from 'payload'
import config from '@payload-config'

import {
  collectAccountingRows,
  toAccountingCsv,
} from '../lib/invoicing/export.ts'

const parseDate = (value: string | undefined, fallback: Date): Date => {
  if (!value) return fallback

  const parsed = new Date(`${value}T00:00:00.000Z`)

  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid date: ${value} (expected YYYY-MM-DD)`)
  }

  return parsed
}

const now = new Date()
const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
const yearEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31))

const from = parseDate(process.env.FROM, yearStart)
const to = parseDate(process.env.TO, yearEnd)

if (to < from) {
  console.error(
    `TO (${to.toISOString()}) is before FROM (${from.toISOString()}).`,
  )
  process.exit(1)
}

const payload = await getPayload({ config })

const rows = await collectAccountingRows({ payload, from, to })
const csv = toAccountingCsv(rows)

const out = process.env.OUT

if (out) {
  writeFileSync(out, csv, 'utf8')

  const invoices = rows.filter((row) => row.documentType === 'INVOICE').length
  const credits = rows.length - invoices
  // Signed, so this is the period's net revenue without the reader having to
  // know which rows to subtract.
  const net = rows.reduce((total, row) => total + row.totalMinor, 0)

  console.error(
    `${String(rows.length)} document(s): ${String(invoices)} invoice(s), ` +
      `${String(credits)} credit note(s). Net ${String(net)} minor units. -> ${out}`,
  )
} else {
  process.stdout.write(csv)
}

process.exit(0)
