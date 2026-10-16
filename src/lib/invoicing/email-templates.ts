/**
 * Czech wording for the emails that carry a document.
 *
 * Short on purpose. The document is the attachment; this is the covering note,
 * and a covering note that restates the whole invoice gives the recipient two
 * things to reconcile instead of one. It says what arrived, for what, how much,
 * and that nothing is owed.
 *
 * It deliberately does NOT contain a download link. A link in an email either
 * needs a token (another bearer credential, in a place that gets forwarded) or
 * leads to a sign-in the customer did not ask for. The PDF is attached and the
 * account page lists everything; neither needs a URL in an inbox.
 */
import { formatMinorAmount } from '../billing/money.ts'
import type { Currency } from '../billing/constants.ts'
import { wrap } from '../auth/email-templates.ts'
import type { RenderedEmail } from '../auth/email-templates.ts'
import { isProduction } from '../env.ts'

const czechDate = (value: Date): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'Europe/Prague',
  }).format(value)

export const invoiceDeliveryEmail = (args: {
  number: string
  amount: number
  currency: Currency
  periodStart: Date
  periodEnd: Date
}): RenderedEmail => {
  const amount = formatMinorAmount(args.amount, args.currency)
  const period = `${czechDate(args.periodStart)} – ${czechDate(args.periodEnd)}`

  return {
    subject: `Faktura ${args.number} – sazejchytre.cz`,
    ...wrap({
      heading: 'Faktura k vašemu předplatnému',
      paragraphs: [
        `V příloze posíláme fakturu č. ${args.number} za období ${period}.`,
        `Celková částka ${amount} byla již uhrazena. Tento e-mail není výzvou k platbě.`,
        'Fakturu najdete také ve svém účtu v přehledu dokladů.',
      ],
      isProduction,
    }),
  }
}

export const creditNoteDeliveryEmail = (args: {
  number: string
  amount: number
  currency: Currency
  correctsNumber: string
}): RenderedEmail => {
  const amount = formatMinorAmount(args.amount, args.currency)

  return {
    subject: `Opravný doklad ${args.number} – sazejchytre.cz`,
    ...wrap({
      heading: 'Opravný doklad',
      paragraphs: [
        `V příloze posíláme opravný doklad č. ${args.number}` +
          (args.correctsNumber ? ` k faktuře č. ${args.correctsNumber}` : '') +
          '.',
        `Vrácená částka: ${amount}.`,
        'Doklad najdete také ve svém účtu v přehledu dokladů.',
      ],
      isProduction,
    }),
  }
}
