import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DocumentBucketNotIsolatedError,
  assertBucketsDiffer,
} from './bucket-isolation.ts'

describe('document bucket isolation', () => {
  it('allows two genuinely different buckets', () => {
    assert.doesNotThrow(() =>
      assertBucketsDiffer('sazejchytre-documents', 'sazejchytre'),
    )
  })

  it('refuses the publicly-bound bucket', () => {
    // The mistake this exists to prevent, and the one that was actually made:
    // a `private/` prefix inside the media bucket is still served over
    // cdn.sazejchytre.cz, because the domain is bound at the bucket root.
    assert.throws(
      () => assertBucketsDiffer('sazejchytre', 'sazejchytre'),
      (error: unknown) => {
        assert.ok(error instanceof DocumentBucketNotIsolatedError)
        assert.equal(error.code, 'DOCUMENT_BUCKET_NOT_ISOLATED')
        // The message has to say what to do, because whoever hits this is
        // looking at a failed invoice and not at this file.
        assert.match(error.message, /separate bucket/)
        assert.match(error.message, /R2_DOCUMENTS_BUCKET/)

        return true
      },
    )
  })

  it('is not fooled by a difference of case alone', () => {
    // R2 names are case-sensitive, so these are technically two buckets — but
    // a name differing only in case is a typo, and treating it as isolation
    // would be exactly the silent misconfiguration this guards against.
    assert.throws(
      () => assertBucketsDiffer('Sazejchytre', 'sazejchytre'),
      DocumentBucketNotIsolatedError,
    )
  })

  it('is not fooled by surrounding whitespace', () => {
    // A trailing space in an environment variable is invisible in a dashboard.
    assert.throws(
      () => assertBucketsDiffer(' sazejchytre ', 'sazejchytre'),
      DocumentBucketNotIsolatedError,
    )
  })

  it('refuses an empty documents bucket', () => {
    // Rather than silently falling back to anything.
    for (const empty of ['', '   ']) {
      assert.throws(
        () => assertBucketsDiffer(empty, 'sazejchytre'),
        DocumentBucketNotIsolatedError,
      )
    }
  })
})
