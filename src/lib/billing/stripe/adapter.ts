/**
 * The Stripe adapter: the only file in the application that knows Stripe
 * exists, apart from the webhook route and the reconciliation script.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PAYMENT ELEMENT, NOT HOSTED CHECKOUT
 *
 * Every operation that needs a card returns a client secret for the Payment
 * Element, never a redirect URL. A hosted checkout page is less work and
 * takes the customer to stripe.com in the middle of buying something — which
 * costs conversions, loses our styling at the one moment it matters most, and
 * makes the purchase feel like it is happening somewhere else. Everything
 * stays on our domain.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CURRENCY AND AMOUNT ARE OURS, AND ARE CHECKED
 *
 * Nothing here infers a currency from the customer, the account default or
 * the price. The caller passes the currency from our own Subscription row,
 * and `assertPrice` proves the Stripe price agrees before a single koruna
 * moves. If they disagree we refuse: charging the wrong amount or the wrong
 * currency costs a refund, an apology and a corrected invoice, all of which
 * are more expensive than a failed request.
 *
 * Amounts are passed through as our integer minor units with no conversion.
 * Stripe also uses minor units, so any arithmetic here would be a bug — and
 * a float is how 299.00 becomes 298.99999999999997.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TWO THINGS THIS API VERSION MOVED
 *
 * See `client.ts` for the detail. Briefly: subscription periods are on the
 * ITEM, not the subscription, and the Payment Element's secret comes from
 * `invoice.confirmation_secret`, not `invoice.payment_intent`. Both of the
 * old paths now yield `undefined` instead of failing, so both are read here
 * through helpers that refuse to carry on without them.
 */
import type Stripe from 'stripe'

import type { Currency } from '../constants.ts'
import {
  type BillingPort,
  type BillingResult,
  type ChangePlanInput,
  type CheckoutIntent,
  type CreateCheckoutSessionInput,
  type CreateSubscriptionInput,
  type EnsureCustomerInput,
  type ListPaymentMethodsInput,
  type PaymentMethodSetupIntent,
  type PaymentMethodSummary,
  type PlanChangeOutcome,
  type ProviderCustomerRef,
  type ProviderSubscription,
  type RefundInput,
  type RefundOutcome,
  type SubscriptionRefInput,
  type UpdatePaymentMethodInput,
  billingFail,
  billingOk,
} from '../port.ts'
import { getStripeClient } from './client.ts'
import { customerMessageFor, translateStripeError } from './errors.ts'
import { soleItem, toCurrency, toProviderSubscription } from './translate.ts'

const PROVIDER = 'STRIPE' as const

/** The failure for a subscription we cannot translate. */
const untranslatable = () =>
  billingFail('INVALID_REQUEST', customerMessageFor('INVALID_REQUEST'), {
    providerCode: 'untranslatable_subscription',
  })

/* -------------------------------------------------------------------------- */
/* The adapter                                                               */
/* -------------------------------------------------------------------------- */

/** Expansions needed to translate a subscription in one round trip. */
const SUBSCRIPTION_EXPAND = ['items.data.price'] as const

/**
 * Metadata key holding our own customer id.
 *
 * Lets support find the Stripe customer from our admin and vice versa, and
 * gives `ensureCustomer` something to search on if the stored provider ref is
 * ever lost.
 */
const LOCAL_CUSTOMER_KEY = 'sazejchytreCustomerId'

/** Strip anything that could break out of a Stripe search query literal. */
const searchSafe = (value: string): string =>
  value.replace(/[^A-Za-z0-9_-]/g, '')

/**
 * Build the Stripe adapter.
 *
 * `injectedClient` exists for one reason: the port contract asserts that an
 * unreachable provider THROWS rather than returning a failure, and the only
 * honest way to test that against a real adapter is to hand it a client
 * pointed somewhere unroutable. Production always uses the shared client.
 */
export const createStripeBillingPort = (
  injectedClient?: Stripe,
): BillingPort => {
  const stripe = injectedClient ?? getStripeClient()

  /**
   * Prove the Stripe price matches what we think we are selling.
   *
   * Runs before every subscription create and plan change. The check is the
   * reason the adapter can promise it never infers a currency: if OUR row and
   * Stripe's price disagree, nobody has to decide which one wins.
   */
  const assertPrice = async (input: {
    providerPriceId: string
    currency: Currency
    expectedAmountMinor: number
  }): Promise<BillingResult<Stripe.Price>> => {
    let price: Stripe.Price

    try {
      price = await stripe.prices.retrieve(input.providerPriceId)
    } catch (error) {
      return translateStripeError(error, 'PRICE')
    }

    if (!price.active) {
      return billingFail(
        'PRICE_NOT_SYNCED',
        customerMessageFor('PRICE_NOT_SYNCED'),
        { providerCode: 'price_inactive' },
      )
    }

    if (price.currency.toUpperCase() !== input.currency) {
      return billingFail(
        'CURRENCY_MISMATCH',
        customerMessageFor('CURRENCY_MISMATCH'),
        { providerCode: `price_currency_${price.currency}` },
      )
    }

    if (price.unit_amount !== input.expectedAmountMinor) {
      // Our Price row and the Stripe price have drifted. Reconciliation is the
      // fix; charging either amount is not.
      return billingFail(
        'AMOUNT_MISMATCH',
        customerMessageFor('AMOUNT_MISMATCH'),
        { providerCode: 'price_amount_drift' },
      )
    }

    return billingOk(price)
  }

  /** Retrieve a subscription, expanded enough to translate. */
  const retrieveSubscription = async (
    providerSubscriptionId: string,
  ): Promise<BillingResult<Stripe.Subscription>> => {
    try {
      return billingOk(
        await stripe.subscriptions.retrieve(providerSubscriptionId, {
          expand: [...SUBSCRIPTION_EXPAND],
        }),
      )
    } catch (error) {
      return translateStripeError(error, 'SUBSCRIPTION')
    }
  }

  /** Retrieve and translate in one step, which most operations want. */
  const readSubscription = async (
    providerSubscriptionId: string,
  ): Promise<BillingResult<ProviderSubscription>> => {
    const retrieved = await retrieveSubscription(providerSubscriptionId)

    if (!retrieved.ok) return retrieved

    const translated = toProviderSubscription(retrieved.value)

    return translated ? billingOk(translated) : untranslatable()
  }

  return {
    provider: PROVIDER,

    async ensureCustomer(
      input: EnsureCustomerInput,
    ): Promise<BillingResult<ProviderCustomerRef>> {
      const localId = String(input.customerId)

      // 1. The id we already hold. The normal path.
      if (input.existingExternalId) {
        try {
          const existing = await stripe.customers.retrieve(
            input.existingExternalId,
          )

          if (!existing.deleted) {
            return billingOk({
              provider: PROVIDER,
              externalId: existing.id,
            })
          }
          // A deleted customer falls through to creating a fresh one. Stripe
          // keeps deleted customers retrievable, and reusing one would attach
          // a subscription to a record that can never be charged.
        } catch (error) {
          const failure = translateStripeError(error, 'CUSTOMER')

          // Anything other than "it is gone" is a real problem.
          if (failure.code !== 'CUSTOMER_NOT_FOUND') return failure
        }
      }

      // 2. Search by our own id, in case the stored ref was lost.
      try {
        const found = await stripe.customers.search({
          query: `metadata['${LOCAL_CUSTOMER_KEY}']:'${searchSafe(localId)}'`,
          limit: 1,
        })

        const match = found.data[0]

        if (match) {
          return billingOk({ provider: PROVIDER, externalId: match.id })
        }
      } catch (error) {
        // Search is a convenience, not the source of truth. A search outage
        // must not stop somebody subscribing — the idempotency key below is
        // what actually prevents a duplicate.
        const failure = translateStripeError(error, 'CUSTOMER')

        if (failure.code !== 'INVALID_REQUEST') return failure
      }

      // 3. Create. The idempotency key means a retry inside Stripe's 24-hour
      // window returns the same customer rather than a second one, which
      // covers the gap while the search index catches up.
      try {
        const created = await stripe.customers.create(
          {
            email: input.email,
            ...(input.name ? { name: input.name } : {}),
            ...(input.billingCountry
              ? { address: { country: input.billingCountry } }
              : {}),
            metadata: { [LOCAL_CUSTOMER_KEY]: localId },
          },
          { idempotencyKey: `ensure-customer:${localId}` },
        )

        return billingOk({ provider: PROVIDER, externalId: created.id })
      } catch (error) {
        return translateStripeError(error, 'CUSTOMER')
      }
    },

    async createCheckoutSession(
      input: CreateCheckoutSessionInput,
    ): Promise<BillingResult<CheckoutIntent>> {
      const priced = await assertPrice(input)

      if (!priced.ok) return priced

      const trialDays = input.trialDays ?? 0

      let subscription: Stripe.Subscription

      try {
        subscription = await stripe.subscriptions.create({
          customer: input.providerCustomerId,
          items: [{ price: priced.value.id, quantity: 1 }],
          // Our currency, passed explicitly. The price has already been
          // proved to match it, so this cannot contradict the price; it is
          // here so that no Stripe-side default can creep in.
          currency: input.currency.toLowerCase(),
          // Creates the subscription INCOMPLETE and an invoice we then
          // confirm from the Payment Element. Without this Stripe would try
          // to charge immediately and fail for a customer with no card.
          payment_behavior: 'default_incomplete',
          payment_settings: {
            save_default_payment_method: 'on_subscription',
          },
          ...(trialDays > 0
            ? {
                trial_period_days: trialDays,
                // No money is due, so there is no invoice to confirm. Ask
                // Stripe for a SetupIntent instead, so the form can still
                // collect a card for the first real renewal.
                trial_settings: {
                  end_behavior: { missing_payment_method: 'cancel' },
                },
              }
            : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
          expand: [
            'latest_invoice.confirmation_secret',
            'pending_setup_intent',
            ...SUBSCRIPTION_EXPAND,
          ],
        })
      } catch (error) {
        return translateStripeError(error, 'CUSTOMER')
      }

      const translated = toProviderSubscription(subscription)

      if (!translated) return untranslatable()

      // THE MOVED FIELD. `invoice.payment_intent` is no longer the route to a
      // client secret; `confirmation_secret` is, and it only appears when
      // expanded.
      const invoice =
        typeof subscription.latest_invoice === 'object'
          ? subscription.latest_invoice
          : null
      const paymentSecret = invoice?.confirmation_secret?.client_secret ?? null

      const setupIntent =
        typeof subscription.pending_setup_intent === 'object'
          ? subscription.pending_setup_intent
          : null
      const setupSecret = setupIntent?.client_secret ?? null

      const secret = paymentSecret
        ? { clientSecret: paymentSecret, secretType: 'PAYMENT' as const }
        : setupSecret
          ? { clientSecret: setupSecret, secretType: 'SETUP' as const }
          : null

      if (!secret) {
        // No secret means the front end has nothing to confirm, so the
        // customer would stare at a dead form. Better to fail here than to
        // leave an INCOMPLETE subscription nobody can finish.
        return billingFail(
          'PROCESSING_ERROR',
          customerMessageFor('PROCESSING_ERROR'),
          { providerCode: 'no_confirmation_secret' },
        )
      }

      return billingOk({
        provider: PROVIDER,
        providerSubscriptionId: subscription.id,
        ...secret,
        status: translated.status,
        // From OUR input. `assertPrice` has already proved Stripe agrees.
        currency: input.currency,
        amountMinor: invoice?.amount_due ?? 0,
      })
    },

    async createSubscription(
      input: CreateSubscriptionInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      const priced = await assertPrice(input)

      if (!priced.ok) return priced

      const trialDays = input.trialDays ?? 0

      try {
        const subscription = await stripe.subscriptions.create({
          customer: input.providerCustomerId,
          items: [{ price: priced.value.id, quantity: 1 }],
          currency: input.currency.toLowerCase(),
          // The customer already has a card on file. Fail loudly rather than
          // leaving a subscription that looks created but grants nothing —
          // the decline becomes a typed failure through `translateStripeError`.
          payment_behavior: 'error_if_incomplete',
          ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
          expand: [...SUBSCRIPTION_EXPAND],
        })

        const translated = toProviderSubscription(subscription)

        return translated ? billingOk(translated) : untranslatable()
      } catch (error) {
        return translateStripeError(error, 'CUSTOMER')
      }
    },

    async changePlan(
      input: ChangePlanInput,
    ): Promise<BillingResult<PlanChangeOutcome>> {
      const priced = await assertPrice(input)

      if (!priced.ok) return priced

      const retrieved = await retrieveSubscription(input.providerSubscriptionId)

      if (!retrieved.ok) return retrieved

      const subscription = retrieved.value
      const item = soleItem(subscription)

      if (!item) return untranslatable()

      if (
        subscription.status === 'canceled' ||
        subscription.status === 'incomplete_expired'
      ) {
        return billingFail(
          'NOT_CANCELABLE',
          customerMessageFor('NOT_CANCELABLE'),
          { providerCode: `status_${subscription.status}` },
        )
      }

      /* --- Upgrade: now, with proration ---------------------------------- */

      if (input.direction === 'UPGRADE') {
        try {
          const updated = await stripe.subscriptions.update(
            subscription.id,
            {
              items: [{ id: item.id, price: priced.value.id, quantity: 1 }],
              // Invoice the difference immediately. `create_prorations` would
              // park the credit on the next invoice, so somebody upgrading
              // mid-month would get the better plan for free until renewal.
              proration_behavior: 'always_invoice',
              // If the proration charge fails, leave the subscription alone.
              // Granting the dearer plan on an unpaid invoice is exactly the
              // mistake this whole module is written to avoid.
              payment_behavior: 'error_if_incomplete',
              expand: ['latest_invoice', ...SUBSCRIPTION_EXPAND],
            },
            {
              idempotencyKey: `change-plan:${subscription.id}:${priced.value.id}`,
            },
          )

          const translated = toProviderSubscription(updated)

          if (!translated) return untranslatable()

          const invoice =
            typeof updated.latest_invoice === 'object'
              ? updated.latest_invoice
              : null

          return billingOk({
            subscription: translated,
            effect: 'IMMEDIATE',
            // Already in minor units. Null rather than a guess when Stripe
            // did not give us an invoice to read it off.
            prorationMinor: invoice ? invoice.amount_due : null,
          })
        } catch (error) {
          return translateStripeError(error, 'SUBSCRIPTION')
        }
      }

      /* --- Downgrade: at period end, via a schedule ----------------------- */

      // A downgrade must not take effect now: the customer has paid for the
      // dearer plan until the period ends, and clawing it back early with a
      // partial refund is worse for them and more work for us.
      //
      // `subscriptions.update` cannot defer a price change — every proration
      // behaviour it offers still swaps the price immediately, differing only
      // in how the money is handled. A subscription schedule is Stripe's
      // mechanism for "this price, then that price", so that is what this
      // uses: phase one keeps the current price to the end of the paid
      // period, phase two starts the new one.
      try {
        const schedule = subscription.schedule
          ? await stripe.subscriptionSchedules.retrieve(
              typeof subscription.schedule === 'string'
                ? subscription.schedule
                : subscription.schedule.id,
            )
          : await stripe.subscriptionSchedules.create({
              from_subscription: subscription.id,
            })

        const currentPhase = schedule.phases.at(-1)

        if (!currentPhase) return untranslatable()

        const currentPriceId = currentPhase.items[0]?.price

        if (typeof currentPriceId !== 'string') return untranslatable()

        const phases = [
          {
            items: [{ price: currentPriceId, quantity: 1 }],
            start_date: currentPhase.start_date,
            end_date: currentPhase.end_date,
          },
          {
            items: [{ price: priced.value.id, quantity: 1 }],
            // One cycle of the new price, after which `end_behavior:
            // 'release'` hands the subscription back and it carries on
            // renewing normally. A phase with no duration at all would
            // never complete, so the schedule would stay attached for ever
            // and every later change would have to go through it.
            duration: {
              interval: priced.value.recurring?.interval ?? 'month',
              interval_count: priced.value.recurring?.interval_count ?? 1,
            },
          },
        ]

        // Stripe cannot take `phases` on a `from_subscription` create, so the
        // schedule has to be created and then updated. That is a
        // read-after-write: the update has been observed to fail once with
        // `resource_missing` for a schedule that demonstrably existed, which
        // is Stripe-side propagation rather than anything wrong with the
        // request. One retry, because the alternative is losing the whole
        // downgrade to a race we can see — and re-sending the same phases is
        // idempotent in effect, since `phases` sets a state rather than
        // appending to one.
        const applyPhases = async (): Promise<void> => {
          await stripe.subscriptionSchedules.update(schedule.id, {
            // Hand control back to the subscription once the new phase
            // starts, so later changes do not all have to go through the
            // schedule.
            end_behavior: 'release',
            phases,
            // Nothing to prorate: the switch happens exactly on a boundary.
            proration_behavior: 'none',
          })
        }

        try {
          await applyPhases()
        } catch (error) {
          const failure = translateStripeError(error, 'SUBSCRIPTION')

          // Only for the propagation case. Anything else is a real rejection
          // and retrying it would just fail again more slowly.
          if (failure.providerCode !== 'resource_missing') throw error

          await applyPhases()
        }
      } catch (error) {
        return translateStripeError(error, 'SUBSCRIPTION')
      }

      // Read back rather than trusting the write. The subscription should
      // still be on the old price, and a test asserts exactly that.
      const after = await readSubscription(subscription.id)

      if (!after.ok) return after

      return billingOk({
        subscription: after.value,
        effect: 'AT_PERIOD_END',
        prorationMinor: 0,
      })
    },

    async cancelAtPeriodEnd(
      input: SubscriptionRefInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      const retrieved = await retrieveSubscription(input.providerSubscriptionId)

      if (!retrieved.ok) return retrieved

      const subscription = retrieved.value

      if (
        subscription.status === 'canceled' ||
        subscription.status === 'incomplete_expired'
      ) {
        return billingFail(
          'ALREADY_CANCELED',
          customerMessageFor('ALREADY_CANCELED'),
        )
      }

      // Already flagged: return the current state rather than writing again.
      // Idempotent by the port's contract, and a second write would re-stamp
      // `canceled_at` and emit another webhook for no reason.
      if (subscription.cancel_at_period_end) {
        const translated = toProviderSubscription(subscription)

        return translated ? billingOk(translated) : untranslatable()
      }

      try {
        const updated = await stripe.subscriptions.update(subscription.id, {
          cancel_at_period_end: true,
          expand: [...SUBSCRIPTION_EXPAND],
        })

        const translated = toProviderSubscription(updated)

        return translated ? billingOk(translated) : untranslatable()
      } catch (error) {
        return translateStripeError(error, 'SUBSCRIPTION')
      }
    },

    async cancelImmediately(
      input: SubscriptionRefInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      const retrieved = await retrieveSubscription(input.providerSubscriptionId)

      if (!retrieved.ok) return retrieved

      if (
        retrieved.value.status === 'canceled' ||
        retrieved.value.status === 'incomplete_expired'
      ) {
        return billingFail(
          'ALREADY_CANCELED',
          customerMessageFor('ALREADY_CANCELED'),
        )
      }

      try {
        // No `prorate` and no `invoice_now`: this forfeits the rest of the
        // paid period deliberately. Admin-only for that reason — see
        // `src/lib/billing/lifecycle.ts`.
        const canceled = await stripe.subscriptions.cancel(retrieved.value.id, {
          expand: [...SUBSCRIPTION_EXPAND],
        })

        const translated = toProviderSubscription(canceled)

        return translated ? billingOk(translated) : untranslatable()
      } catch (error) {
        return translateStripeError(error, 'SUBSCRIPTION')
      }
    },

    async resumeSubscription(
      input: SubscriptionRefInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      const retrieved = await retrieveSubscription(input.providerSubscriptionId)

      if (!retrieved.ok) return retrieved

      const subscription = retrieved.value

      if (
        subscription.status === 'canceled' ||
        subscription.status === 'incomplete_expired'
      ) {
        // Stripe cannot revive an ended subscription either. That is a new
        // subscription, with a new period and a new payment.
        return billingFail(
          'NOTHING_TO_RESUME',
          'Ukončené předplatné nelze obnovit. Sjednejte prosím nové.',
        )
      }

      if (!subscription.cancel_at_period_end) {
        return billingFail(
          'NOTHING_TO_RESUME',
          customerMessageFor('NOTHING_TO_RESUME'),
        )
      }

      try {
        const updated = await stripe.subscriptions.update(subscription.id, {
          cancel_at_period_end: false,
          expand: [...SUBSCRIPTION_EXPAND],
        })

        const translated = toProviderSubscription(updated)

        return translated ? billingOk(translated) : untranslatable()
      } catch (error) {
        return translateStripeError(error, 'SUBSCRIPTION')
      }
    },

    async updatePaymentMethod(
      input: UpdatePaymentMethodInput,
    ): Promise<BillingResult<PaymentMethodSetupIntent>> {
      try {
        const intent = await stripe.setupIntents.create({
          customer: input.providerCustomerId,
          // The card will be charged on renewals when nobody is present.
          usage: 'off_session',
          automatic_payment_methods: { enabled: true },
        })

        if (!intent.client_secret) {
          return billingFail(
            'PROCESSING_ERROR',
            customerMessageFor('PROCESSING_ERROR'),
            { providerCode: 'no_setup_client_secret' },
          )
        }

        return billingOk({
          provider: PROVIDER,
          clientSecret: intent.client_secret,
        })
      } catch (error) {
        return translateStripeError(error, 'CUSTOMER')
      }
    },

    async listPaymentMethods(
      input: ListPaymentMethodsInput,
    ): Promise<BillingResult<PaymentMethodSummary[]>> {
      try {
        const [customer, methods] = await Promise.all([
          stripe.customers.retrieve(input.providerCustomerId),
          stripe.paymentMethods.list({
            customer: input.providerCustomerId,
            type: 'card',
            limit: 20,
          }),
        ])

        // A deleted customer has no settings at all, so narrow before asking.
        const settings = customer.deleted ? null : customer.invoice_settings
        const configuredDefault = settings?.default_payment_method ?? null
        const defaultId =
          typeof configuredDefault === 'string'
            ? configuredDefault
            : (configuredDefault?.id ?? null)

        return billingOk(
          methods.data.flatMap((method) => {
            const card = method.card

            // Only what we are allowed to keep: brand, last four, expiry.
            // There is no branch of this function that can emit a PAN,
            // because `card.number` does not exist on a retrieved method.
            if (!card) return []

            return [
              {
                providerPaymentMethodId: method.id,
                brand: card.brand,
                last4: card.last4,
                expiryMonth: card.exp_month,
                expiryYear: card.exp_year,
                isDefault: method.id === defaultId,
              },
            ]
          }),
        )
      } catch (error) {
        return translateStripeError(error, 'CUSTOMER')
      }
    },

    async refund(input: RefundInput): Promise<BillingResult<RefundOutcome>> {
      // Read the charge FIRST.
      //
      // `refunds.create` takes no currency — Stripe refunds in whatever the
      // charge was in — so without this the `currency` the port requires the
      // caller to pass would be silently ignored, and a refund issued against
      // a charge in the wrong currency would succeed and produce a credit
      // note that does not match the invoice it credits. The contract suite
      // running against the live API is what caught this.
      //
      // The charge is read for the currency ONLY. It is tempting to also
      // check the refundable amount here, but that would break idempotent
      // replay: a retried full refund would find nothing left to refund and
      // report ALREADY_REFUNDED, where passing the same idempotency key to
      // Stripe returns the original refund and the caller gets the success it
      // already earned. Over-refunds and double-refunds are caught by
      // `translateStripeError` with REFUND context instead.
      let charge: Stripe.Charge

      try {
        charge = await stripe.charges.retrieve(input.providerChargeId)
      } catch (error) {
        return translateStripeError(error, 'CHARGE')
      }

      const chargeCurrency = toCurrency(charge.currency)

      if (!chargeCurrency || chargeCurrency !== input.currency) {
        return billingFail(
          'CURRENCY_MISMATCH',
          customerMessageFor('CURRENCY_MISMATCH'),
          { providerCode: `charge_currency_${charge.currency}` },
        )
      }

      // A non-positive amount is OUR bug, not something to ask Stripe about:
      // it would be rejected anyway, and the idempotency key would then be
      // burned on a request that can never succeed.
      if (input.amountMinor !== undefined && input.amountMinor <= 0) {
        return billingFail(
          'REFUND_EXCEEDS_CHARGE',
          customerMessageFor('REFUND_EXCEEDS_CHARGE'),
          { providerCode: 'refund_amount_not_positive' },
        )
      }

      try {
        const refund = await stripe.refunds.create(
          {
            charge: input.providerChargeId,
            ...(input.amountMinor !== undefined
              ? { amount: input.amountMinor }
              : {}),
            // Stripe's `reason` is a three-value enum, not free text. Our
            // actual reason goes in metadata, where it is readable, and ends
            // up on the credit note.
            reason: 'requested_by_customer',
            metadata: { sazejchytreReason: input.reason.slice(0, 500) },
          },
          // Our key, not the SDK's retry key: this must hold across our own
          // retries and process restarts, not just within one request.
          { idempotencyKey: input.idempotencyKey },
        )

        const currency = toCurrency(refund.currency)

        if (!currency) return untranslatable()

        return billingOk({
          provider: PROVIDER,
          providerRefundId: refund.id,
          providerChargeId: input.providerChargeId,
          amountMinor: refund.amount,
          currency,
          status:
            refund.status === 'succeeded'
              ? 'SUCCEEDED'
              : refund.status === 'failed' || refund.status === 'canceled'
                ? 'FAILED'
                : 'PENDING',
        })
      } catch (error) {
        // REFUND context matters: an over-refund arrives as an invalid-request
        // error with NO code, only `param: 'amount'`, and a second full
        // refund arrives as `charge_already_refunded`. Without the context
        // both would flatten into a generic failure.
        return translateStripeError(error, 'REFUND')
      }
    },

    async getSubscription(
      input: SubscriptionRefInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      return readSubscription(input.providerSubscriptionId)
    },
  }
}
