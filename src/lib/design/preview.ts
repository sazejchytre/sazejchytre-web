/**
 * The design-preview gate, wired to the real environment.
 *
 * Kept apart from `preview-gate.ts` so the decision itself can be tested
 * without loading `env.ts`, whose schema demands every server secret at
 * import time. This file adds exactly two reads and no logic.
 *
 * `process.env.NODE_ENV` is written out in full on purpose: that exact member
 * expression is what Next inlines as a literal at build time (see
 * `preview-gate.ts`). Destructuring it, or reading `process.env[key]`, would
 * defeat the inlining and leave only the runtime check.
 */
import { env } from '../env.ts'
import { isDesignPreviewEnabled } from './preview-gate.ts'

export const designPreviewEnabled = (): boolean =>
  isDesignPreviewEnabled({
    build: process.env.NODE_ENV,
    runtime: env.NODE_ENV,
  })
