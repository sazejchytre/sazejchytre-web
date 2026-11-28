import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isAdminSignInOperation, payloadApiAccess } from './payload-api.ts'

describe('Payload REST API under the launch gate', () => {
  const contentReads = [
    '/api/legal-pages',
    '/api/legal-pages/1',
    '/api/faq-entries',
    '/api/media',
    '/api/globals/site-settings',
    '/api/tips',
    '/api/users',
    '/api/graphql',
  ]

  it('is untouched outside PRIVATE mode', () => {
    for (const mode of ['INFORMATIONAL', 'FULL'] as const) {
      for (const path of contentReads) {
        for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
          assert.equal(
            payloadApiAccess(mode, method, path),
            'open',
            `${mode} ${method} ${path}`,
          )
        }
      }
    }
  })

  it('requires an administrator for every content read in PRIVATE mode', () => {
    for (const path of contentReads) {
      for (const method of [
        'GET',
        'HEAD',
        'POST',
        'PATCH',
        'DELETE',
        'OPTIONS',
      ]) {
        assert.equal(
          payloadApiAccess('PRIVATE', method, path),
          'administrator-only',
          `${method} ${path}`,
        )
      }
    }
  })

  it('treats an invalid mode as PRIVATE', () => {
    for (const mode of [undefined, '', 'full', 'FULL ']) {
      assert.equal(
        payloadApiAccess(mode, 'GET', '/api/legal-pages'),
        'administrator-only',
        String(mode),
      )
    }
  })

  it('keeps the administrator sign-in operations reachable in PRIVATE mode', () => {
    const signIn: Array<[string, string]> = [
      ['GET', '/api/access'],
      ['GET', '/api/users/me'],
      ['HEAD', '/api/users/me'],
      ['GET', '/api/users/init'],
      ['POST', '/api/users/login'],
      ['POST', '/api/users/logout'],
      ['POST', '/api/users/refresh-token'],
      ['POST', '/api/users/forgot-password'],
      ['POST', '/api/users/reset-password'],
      ['POST', '/api/users/first-register'],
      ['POST', '/api/users/unlock'],
      ['POST', '/api/users/verify/abc123'],
    ]

    for (const [method, path] of signIn) {
      assert.equal(
        isAdminSignInOperation(method, path),
        true,
        `${method} ${path}`,
      )
      assert.equal(
        payloadApiAccess('PRIVATE', method, path),
        'open',
        `${method} ${path}`,
      )
    }
  })

  it('does not widen a sign-in path to other methods or neighbours', () => {
    const notSignIn: Array<[string, string]> = [
      ['GET', '/api/users/login'],
      ['DELETE', '/api/users/me'],
      ['PATCH', '/api/users/1'],
      ['GET', '/api/users'],
      ['GET', '/api/users/me/extra'],
      ['GET', '/api/users/me?depth=5'],
      ['POST', '/api/users/verify/'],
      ['POST', '/api/users/verify/a/b'],
      ['POST', '/api/customers/login'],
      ['GET', '/api/legal-pages/access'],
    ]

    for (const [method, path] of notSignIn) {
      assert.equal(
        isAdminSignInOperation(method, path),
        false,
        `${method} ${path}`,
      )
    }
  })
})
