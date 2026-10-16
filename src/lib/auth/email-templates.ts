/**
 * Czech copy for every transactional email, as PURE functions.
 *
 * Separated from the sender so the wording, the escaping and the plain-text
 * alternative are all testable without a network call or an API key.
 *
 * RULES THESE TEMPLATES FOLLOW
 *
 *  - Plain and short. Every one of these arrives because the customer did
 *    something a moment ago, or because something happened to their account
 *    that they need to react to. Neither case wants marketing prose.
 *
 *  - A plain-text alternative always. Some clients refuse HTML, some people
 *    turn it off, and a security notice that renders as a blank message is
 *    worse than no notice.
 *
 *  - Operator identity is IMPORTED, never written out. `src/lib/legal/`
 *    `operator.ts` is the single source of truth and is still placeholders;
 *    `assertOperatorConfigured()` is what stops a guess reaching production.
 *
 *  - No token, code or secret appears in a subject line, and nothing here is
 *    logged. Links carry tokens; the logging module redacts them.
 */
import {
  OPERATOR,
  assertOperatorConfigured,
  formatOperatorAddress,
} from '../legal/operator.ts'

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

/** Minimal HTML escaping for interpolated values. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * Operator footer, or an obvious placeholder in development.
 *
 * In production `assertOperatorConfigured()` throws, so an email cannot go out
 * with a fabricated company name and address on it. In development it is
 * allowed through so the flows are testable, but it says plainly that the
 * details are unset rather than inventing plausible ones.
 */
const operatorFooter = (
  isProduction: boolean,
): { html: string; text: string } => {
  if (isProduction) {
    // Throws when any field is still a TODO. Deliberately not caught: an
    // invented IČO on a commercial email is a compliance failure, and a
    // failed send is recoverable where a wrong legal notice is not.
    assertOperatorConfigured()
  }

  const unresolved = OPERATOR.name.startsWith('TODO:')

  if (unresolved) {
    const warning =
      'Údaje o provozovateli nejsou nastaveny (vývojové prostředí).'

    return {
      html: `<p style="color:#888;font-size:12px">${escapeHtml(warning)}</p>`,
      text: warning,
    }
  }

  const lines = [OPERATOR.name, formatOperatorAddress(), `IČO: ${OPERATOR.ico}`]

  return {
    html: `<p style="color:#888;font-size:12px">${lines.map(escapeHtml).join('<br>')}</p>`,
    text: lines.join('\n'),
  }
}

type Wrapped = {
  heading: string
  paragraphs: string[]
  action?: { label: string; url: string }
  /** Appended verbatim at the end of the body, before the footer. */
  closing?: string[]
  isProduction: boolean
}

/** One layout for all of them, so the emails look like they come from us. */
/**
 * The shared HTML shell and operator footer.
 *
 * Exported so the invoicing emails use the same body and the same footer
 * rules — including `assertOperatorConfigured()` refusing in production —
 * rather than growing a second shell that drifts from this one.
 */
export const wrap = ({
  heading,
  paragraphs,
  action,
  closing = [],
  isProduction,
}: Wrapped): { html: string; text: string } => {
  const footer = operatorFooter(isProduction)

  const htmlParts = [
    `<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    ...paragraphs.map(
      (p) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(p)}</p>`,
    ),
  ]

  if (action) {
    htmlParts.push(
      `<p style="margin:16px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:4px">${escapeHtml(action.label)}</a></p>`,
      `<p style="margin:0 0 12px;font-size:12px;color:#555">Pokud tlačítko nefunguje, otevřete tento odkaz:<br>${escapeHtml(action.url)}</p>`,
    )
  }

  htmlParts.push(
    ...closing.map(
      (p) =>
        `<p style="margin:0 0 12px;line-height:1.5;font-size:14px">${escapeHtml(p)}</p>`,
    ),
    '<hr style="border:none;border-top:1px solid #eee;margin:24px 0">',
    footer.html,
  )

  const textParts = [heading, '', ...paragraphs]

  if (action) {
    textParts.push('', `${action.label}:`, action.url)
  }

  textParts.push('', ...closing, '', '---', footer.text)

  return {
    html: `<!doctype html><html lang="cs"><body style="font-family:system-ui,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">${htmlParts.join('')}</body></html>`,
    text: textParts.join('\n'),
  }
}

/* -------------------------------------------------------------------------- */
/* 1. Verify address                                                          */
/* -------------------------------------------------------------------------- */

export const verifyEmailTemplate = (args: {
  url: string
  isProduction: boolean
}): RenderedEmail => ({
  subject: 'Potvrďte svůj e-mail',
  ...wrap({
    heading: 'Potvrďte svůj e-mail',
    paragraphs: [
      'Potvrzením e-mailu dokončíte registraci. Bez potvrzení si můžete prohlédnout svůj účet, ale nelze objednat předplatné.',
      'Odkaz platí 24 hodin.',
    ],
    action: { label: 'Potvrdit e-mail', url: args.url },
    closing: [
      'Pokud jste se neregistrovali, tento e-mail ignorujte. Bez potvrzení se nic nestane.',
    ],
    isProduction: args.isProduction,
  }),
})

/* -------------------------------------------------------------------------- */
/* 2. Password reset                                                          */
/* -------------------------------------------------------------------------- */

export const passwordResetTemplate = (args: {
  url: string
  isProduction: boolean
}): RenderedEmail => ({
  subject: 'Obnovení hesla',
  ...wrap({
    heading: 'Obnovení hesla',
    paragraphs: [
      'Požádali jste o nastavení nového hesla. Odkaz platí 1 hodinu a lze ho použít jen jednou.',
    ],
    action: { label: 'Nastavit nové heslo', url: args.url },
    closing: [
      'Pokud jste o obnovení nežádali, nemusíte nic dělat — vaše heslo zůstává nezměněné.',
    ],
    isProduction: args.isProduction,
  }),
})

/* -------------------------------------------------------------------------- */
/* 3. Password changed                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Sent to the PREVIOUS address after a password or email change.
 *
 * This is the message that lets someone notice an account takeover, so it goes
 * to where the attacker no longer controls the inbox.
 */
export const passwordChangedTemplate = (args: {
  changedAt: Date
  isProduction: boolean
}): RenderedEmail => ({
  subject: 'Heslo bylo změněno',
  ...wrap({
    heading: 'Heslo bylo změněno',
    paragraphs: [
      `Heslo k vašemu účtu bylo změněno ${formatCzechDateTime(args.changedAt)}.`,
      'Z bezpečnostních důvodů jsme vás odhlásili na všech ostatních zařízeních.',
    ],
    closing: [
      'Pokud jste heslo neměnili vy, okamžitě nás kontaktujte — někdo jiný má přístup k vašemu účtu.',
    ],
    isProduction: args.isProduction,
  }),
})

export const emailChangedTemplate = (args: {
  newEmail: string
  changedAt: Date
  isProduction: boolean
}): RenderedEmail => ({
  subject: 'E-mail účtu byl změněn',
  ...wrap({
    heading: 'E-mail účtu byl změněn',
    paragraphs: [
      `E-mail vašeho účtu byl ${formatCzechDateTime(args.changedAt)} změněn na ${args.newEmail}.`,
      'Z bezpečnostních důvodů jsme vás odhlásili na všech ostatních zařízeních.',
    ],
    closing: [
      'Pokud jste tuto změnu neprovedli, okamžitě nás kontaktujte. Tento e-mail posíláme na vaši původní adresu.',
    ],
    isProduction: args.isProduction,
  }),
})

/* -------------------------------------------------------------------------- */
/* 4. New sign-in from an unrecognised device                                 */
/* -------------------------------------------------------------------------- */

export const newDeviceSignInTemplate = (args: {
  device: string
  country: string | null
  signedInAt: Date
  isProduction: boolean
}): RenderedEmail => ({
  subject: 'Nové přihlášení k účtu',
  ...wrap({
    heading: 'Nové přihlášení k účtu',
    paragraphs: [
      `K vašemu účtu se někdo přihlásil ${formatCzechDateTime(args.signedInAt)}.`,
      args.country
        ? `Zařízení: ${args.device}, země: ${args.country}.`
        : `Zařízení: ${args.device}.`,
    ],
    closing: [
      'Pokud to byla vaše akce, nemusíte nic dělat.',
      'Pokud ne, změňte si heslo — v nastavení účtu můžete také odhlásit všechna ostatní zařízení.',
    ],
    isProduction: args.isProduction,
  }),
})

/* -------------------------------------------------------------------------- */
/* 5–7. Two-factor notices                                                    */
/* -------------------------------------------------------------------------- */

export const twoFactorEnabledTemplate = (args: {
  isProduction: boolean
}): RenderedEmail => ({
  subject: 'Dvoufázové ověření bylo zapnuto',
  ...wrap({
    heading: 'Dvoufázové ověření bylo zapnuto',
    paragraphs: [
      'K přihlášení teď budete kromě hesla potřebovat kód z aplikace.',
      'Uschovejte si záložní kódy, které jsme vám zobrazili. Bez nich a bez aplikace se k účtu nedostanete.',
    ],
    closing: ['Pokud jste to nezapnuli vy, okamžitě nás kontaktujte.'],
    isProduction: args.isProduction,
  }),
})

export const twoFactorDisabledTemplate = (args: {
  isProduction: boolean
}): RenderedEmail => ({
  subject: 'Dvoufázové ověření bylo vypnuto',
  ...wrap({
    heading: 'Dvoufázové ověření bylo vypnuto',
    paragraphs: [
      'K přihlášení teď stačí e-mail a heslo. Váš účet je tím méně chráněný.',
    ],
    closing: ['Pokud jste to nevypnuli vy, okamžitě nás kontaktujte.'],
    isProduction: args.isProduction,
  }),
})

export const backupCodesRegeneratedTemplate = (args: {
  isProduction: boolean
}): RenderedEmail => ({
  subject: 'Záložní kódy byly vygenerovány znovu',
  ...wrap({
    heading: 'Záložní kódy byly vygenerovány znovu',
    paragraphs: [
      'Vaše předchozí záložní kódy už neplatí. Platí jen ta nová sada, kterou jsme vám právě zobrazili.',
    ],
    closing: ['Pokud jste je negenerovali vy, okamžitě nás kontaktujte.'],
    isProduction: args.isProduction,
  }),
})

/* -------------------------------------------------------------------------- */

/** Czech date and time, in Prague, for email bodies. */
export const formatCzechDateTime = (date: Date): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(date)
