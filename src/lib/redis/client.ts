/**
 * The Upstash REST transport.
 *
 * Does one thing — run commands or raise — and never decides what an outage
 * means. That decision belongs to each policy, and the two in this codebase
 * decide it differently: `src/lib/auth/rate-limit.ts` fails closed, because
 * an outage there is an unlimited password-guessing window;
 * `src/lib/forms/rate-limit.ts` fails open, because an outage there would
 * stop a customer reaching support and Turnstile still stands in front.
 *
 * Separate from `upstash.ts` because this file reads credentials and that one
 * does not — see the note there.
 *
 * No `@upstash/redis` dependency: the REST endpoint is plain HTTP and this is
 * forty lines. A dependency here would be one more thing to keep updated for
 * the sake of a `fetch`.
 */
import { env } from '../env.ts'
import { RedisUnavailableError } from './upstash.ts'

/** How long we wait on Redis before treating it as unreachable. */
const REDIS_TIMEOUT_MS = 2_000

/**
 * Run a pipeline of Redis commands in one round trip.
 *
 * Pipelined rather than issued one at a time: a limiter needs an INCR and an
 * EXPIRE together, and two serial round trips to another region would double
 * the latency added to every request it protects.
 *
 * @throws {RedisUnavailableError} on any fault, including a command-level
 *   error inside an otherwise successful response.
 */
export const redisPipeline = async (
  commands: readonly (readonly string[])[],
): Promise<unknown[]> => {
  let response: Response

  try {
    response = await fetch(`${env.UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new RedisUnavailableError('Upstash request failed', { cause })
  }

  if (!response.ok) {
    throw new RedisUnavailableError(
      `Upstash responded ${String(response.status)}`,
    )
  }

  let body: unknown

  try {
    body = await response.json()
  } catch (cause) {
    throw new RedisUnavailableError('Upstash returned invalid JSON', { cause })
  }

  if (!Array.isArray(body)) {
    throw new RedisUnavailableError('Upstash returned an unexpected shape')
  }

  return body.map((entry) => {
    const item = entry as { result?: unknown; error?: unknown }

    if (item?.error) {
      throw new RedisUnavailableError(String(item.error))
    }

    return item?.result
  })
}
