/**
 * The marker that identifies the private initialization command to the
 * administrator-creation rule.
 *
 * A Symbol, not a string: `req.context` is server-side state, but a symbol
 * key cannot be produced by parsing anything — not JSON, not a query string,
 * not a header — so no request that arrives over the network can carry it.
 * Only code running in this process that imports this module can.
 *
 * Holding the marker is not enough on its own: the rule still refuses unless
 * the administrator table is empty, checked under a lock in the same
 * transaction as the insert (`hooks.ts`).
 */
export const ADMIN_BOOTSTRAP: unique symbol = Symbol(
  'sazejchytre.admin-bootstrap',
)

export type BootstrapContext = { [ADMIN_BOOTSTRAP]: true }

/** Context for the one `payload.create` call the command makes. */
export const bootstrapContext = (): BootstrapContext => ({
  [ADMIN_BOOTSTRAP]: true,
})

export const isBootstrapContext = (context: unknown): boolean =>
  typeof context === 'object' &&
  context !== null &&
  (context as Partial<BootstrapContext>)[ADMIN_BOOTSTRAP] === true
