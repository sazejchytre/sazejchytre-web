/**
 * Transactional email delivery through Resend.
 *
 * THE APPLICATION'S ONE TRANSPORT. It lives under `auth/` because that is
 * where the first sender was, and billing now sends through it too — one
 * place that holds the Resend credential, one test seam, one redacting
 * logger. Invoice mail benefits from that logger as much as auth mail does:
 * an invoice email carries a name, an address and a document number, none of
 * which belong in a log.
 *
 * FAILURES ARE NOT SWALLOWED
 *
 * A send that fails must be visible. The two failure modes have different
 * consequences and are handled differently:
 *
 *  - A VERIFICATION email that does not arrive leaves the customer stuck with
 *    an account they cannot finish setting up, and no way to tell whether the
 *    fault is ours or their spam filter. So `sendVerificationEmail` lets the
 *    error propagate: the caller surfaces it as a retryable action ("Poslat
 *    e-mail znovu") rather than claiming success.
 *
 *  - A SECURITY NOTICE ("your password changed") must never block the action
 *    that triggered it. Refusing a password change because an email failed
 *    would leave the customer unable to secure their own account. Those sends
 *    are therefore allowed to fail, but they are LOGGED AT ERROR and reported
 *    through the return value — never silently discarded.
 *
 * The distinction is which failure hurts the customer more: not being able to
 * verify, versus not being able to change a password.
 *
 * Resend is called over plain HTTP rather than through its SDK: one fetch, no
 * extra dependency, and no surprise retry behaviour inside someone else's
 * client.
 */
import { env, isProduction } from '../env.ts'
import type { RenderedEmail } from './email-templates.ts'
import { authLog } from './logging.ts'

/** Raised when Resend refuses or cannot be reached. */
export class EmailDeliveryError extends Error {
  readonly code = 'EMAIL_DELIVERY_FAILED'
  /** True when retrying later could plausibly succeed. */
  readonly retryable: boolean

  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EmailDeliveryError'
    this.retryable = retryable
  }
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const RESEND_TIMEOUT_MS = 10_000

/**
 * A file travelling with the email.
 *
 * Added for invoicing: a customer receiving "here is your invoice" with no
 * invoice attached has to come and find it, which defeats the point of
 * sending anything. The content is held in memory because an invoice is a few
 * kilobytes; anything large enough to need streaming does not belong in an
 * email.
 */
export type EmailAttachment = {
  /** As the recipient will see it, e.g. `FA2026-000001.pdf`. */
  filename: string
  content: Buffer
  /** Defaults to `application/pdf`, which is all we currently send. */
  contentType?: string
}

export type SendArgs = {
  to: string
  email: RenderedEmail
  /** Short label for logs. Never the subject, which can contain user data. */
  kind: string
  /**
   * Files to attach.
   *
   * Never logged, not even by name: an attachment name carries the document
   * number, and a document number plus an email address is more than a log
   * line needs.
   */
  attachments?: readonly EmailAttachment[]
}

/**
 * The thing that actually puts an email on the wire.
 *
 * Swappable so the integration tests can run the real flows — sign-up,
 * verification, reset — without sending anything, and can inspect the token
 * that the email carried. That last part is what makes the log-leak test
 * possible: it needs the real token to grep the logs for.
 *
 * This is a test seam, not a feature. Production never replaces it, and the
 * default below is the only transport that exists.
 */
export type EmailTransport = (args: SendArgs) => Promise<void>

const resendTransport: EmailTransport = async ({
  to,
  email,
  kind,
  attachments,
}) => {
  let response: Response

  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [to],
        subject: email.subject,
        html: email.html,
        // Always both parts. A security notice that renders blank in a
        // text-only client is the same as no notice.
        text: email.text,
        ...(attachments && attachments.length > 0
          ? {
              attachments: attachments.map((attachment) => ({
                filename: attachment.filename,
                // Resend takes base64. Done here rather than by the caller so
                // no other code has to know the provider's wire format.
                content: attachment.content.toString('base64'),
                content_type: attachment.contentType ?? 'application/pdf',
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (cause) {
    // Transport-level: timeout, DNS, TLS. Retrying may work.
    authLog.error('email.transport_failed', { kind, email: to })
    throw new EmailDeliveryError('E-mail se nepodařilo odeslat.', true, {
      cause,
    })
  }

  if (!response.ok) {
    // 4xx is usually our fault (unverified domain, bad address) and will not
    // fix itself; 5xx and 429 are worth retrying.
    const retryable = response.status >= 500 || response.status === 429

    authLog.error('email.rejected', {
      kind,
      email: to,
      status: response.status,
      retryable,
    })

    throw new EmailDeliveryError(
      'E-mail se nepodařilo odeslat.',
      retryable,
      // The body can echo the payload, which includes the token-bearing link.
      // It is deliberately not attached to the error or logged.
    )
  }

  // Note what was sent and to whom, as a hash. Never the subject, the body or
  // the link — all three carry the token.
  // Count, not names: an attachment filename carries the document number.
  authLog.info('email.sent', {
    kind,
    email: to,
    ...(attachments && attachments.length > 0
      ? { attachmentCount: attachments.length }
      : {}),
  })
}

let transport: EmailTransport = resendTransport

/**
 * Replace the transport. Returns a function restoring the previous one.
 *
 * Only the tests call this.
 */
export const setEmailTransport = (next: EmailTransport): (() => void) => {
  const previous = transport
  transport = next

  return () => {
    transport = previous
  }
}

/**
 * Send one email.
 *
 * @throws {EmailDeliveryError} on any refusal or transport fault.
 */
export const sendEmail = async (args: SendArgs): Promise<void> =>
  transport(args)

/**
 * Send a security notice: best effort, loudly reported, never blocking.
 *
 * @returns whether it went out, so a caller can tell the user if it did not.
 */
export const sendSecurityNotice = async (
  args: SendArgs,
): Promise<{ delivered: boolean }> => {
  try {
    await sendEmail(args)

    return { delivered: true }
  } catch (error) {
    // Already logged at error inside sendEmail. Swallowed HERE and only here,
    // because the action it accompanies must still complete.
    authLog.warn('email.notice_not_delivered', {
      kind: args.kind,
      email: args.to,
      retryable: error instanceof EmailDeliveryError ? error.retryable : false,
    })

    return { delivered: false }
  }
}

/** Whether templates should assert operator identity. */
export const emailIsProduction = (): boolean => isProduction

/* -------------------------------------------------------------------------- */
/* Named notices                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Tell the account's address that its password changed.
 *
 * Extracted into a named function because better-auth has NO hook for
 * `changePassword` — only `onPasswordReset`. The notice therefore cannot be
 * attached to the provider and has to be sent at the call site, so there is
 * exactly one call site (`changePasswordAction`) and this function is what it
 * calls. Keeping it here also makes the notice testable without a request
 * context, which a server action is not.
 */
export const notifyPasswordChanged = async (
  to: string,
  changedAt: Date = new Date(),
): Promise<{ delivered: boolean }> => {
  const { passwordChangedTemplate } = await import('./email-templates.ts')
  const { isProduction } = await import('../env.ts')

  return sendSecurityNotice({
    to,
    kind: 'password_changed',
    email: passwordChangedTemplate({ changedAt, isProduction }),
  })
}
