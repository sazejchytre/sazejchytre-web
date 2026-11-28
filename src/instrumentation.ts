/**
 * Server start-up hook. Next calls `register` once per server process and
 * waits for it before the server accepts requests.
 *
 * Its one job here: a production server runs only while a verified
 * administrator exists, checked now and every few seconds afterwards. See
 * `src/lib/admin-presence/runtime.ts` for what that means and why the answer
 * to "none" is stopping the process.
 *
 * The import is dynamic and behind the runtime check because Next evaluates
 * this file for every runtime it builds, and the check needs the Node.js
 * database driver.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { enforceAdministratorPresence } =
    await import('./lib/admin-presence/runtime.ts')

  await enforceAdministratorPresence()
}
