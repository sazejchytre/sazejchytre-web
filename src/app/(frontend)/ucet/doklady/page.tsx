/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { getCurrentCustomer } from '@/lib/auth/customer'
import { formatMinorAmount } from '@/lib/billing/money'
import type { Currency } from '@/lib/billing/constants'

export const metadata: Metadata = { title: 'Doklady' }

/**
 * Not cached, and not statically rendered.
 *
 * The page lists one customer's documents. A cached render would be somebody
 * else's list.
 */
export const dynamic = 'force-dynamic'

const czechDate = (value: string): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))

export default async function DokladyPage() {
  const current = await getCurrentCustomer(await headers())

  if (!current) {
    redirect('/prihlaseni')
  }

  const { customer } = current

  // No customer record yet means no payment has ever been taken, so there is
  // nothing to list. Shown rather than redirected: "you have no documents" is
  // a useful answer.
  if (!customer) {
    return (
      <main>
        <h1>Doklady</h1>
        <p>Zatím nemáte žádné doklady.</p>
        <p>
          <Link href="/ucet">Zpět na účet</Link>
        </p>
      </main>
    )
  }

  const payload = await getPayload({ config: configPromise })

  const [invoices, creditNotes] = await Promise.all([
    payload.find({
      collection: 'invoices',
      depth: 0,
      limit: 100,
      pagination: false,
      overrideAccess: true,
      sort: '-issuedAt',
      // Scoped in the query, not filtered afterwards.
      where: { customer: { equals: customer.id } },
    }),
    payload.find({
      collection: 'credit-notes',
      depth: 1,
      limit: 100,
      pagination: false,
      overrideAccess: true,
      sort: '-issuedAt',
      // Credit notes have no customer of their own; they belong to whoever
      // owns the invoice they correct.
      where: { 'invoice.customer': { equals: customer.id } },
    }),
  ])

  return (
    <main>
      <h1>Doklady</h1>

      <p>
        Faktury za vaše předplatné. Doklady se uchovávají i po zrušení účtu,
        protože je k tomu zákonná povinnost.
      </p>

      <h2>Faktury</h2>

      {invoices.docs.length === 0 ? (
        <p>Zatím nemáte žádné faktury.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Číslo</th>
              <th>Vystaveno</th>
              <th>Částka</th>
              <th>Stav</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.docs.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.number}</td>
                <td>{czechDate(invoice.issuedAt)}</td>
                <td>
                  {formatMinorAmount(
                    invoice.totalMinor,
                    invoice.currency as Currency,
                  )}
                </td>
                <td>
                  {invoice.status === 'CREDITED' ? 'opraveno' : 'uhrazeno'}
                </td>
                <td>
                  {invoice.pdfStorageKey ? (
                    <Link href={`/ucet/doklady/${String(invoice.id)}`}>
                      Stáhnout
                    </Link>
                  ) : (
                    // The document exists; only its PDF has not been rendered
                    // yet. Saying so beats a dead link.
                    'připravuje se'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Opravné doklady</h2>

      {creditNotes.docs.length === 0 ? (
        <p>Žádné opravné doklady.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Číslo</th>
              <th>Vystaveno</th>
              <th>Vráceno</th>
              <th>K faktuře</th>
            </tr>
          </thead>
          <tbody>
            {creditNotes.docs.map((note) => (
              <tr key={note.id}>
                <td>{note.number}</td>
                <td>{czechDate(note.issuedAt)}</td>
                <td>
                  {formatMinorAmount(
                    note.amountMinor,
                    note.currency as Currency,
                  )}
                </td>
                <td>
                  {typeof note.invoice === 'object' && note.invoice !== null
                    ? note.invoice.number
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p>
        <Link href="/ucet">Zpět na účet</Link>
      </p>
    </main>
  )
}
