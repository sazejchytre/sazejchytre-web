/**
 * `notificationEmail` is internal: the public REST read of the site settings
 * must not carry it, while the contact form's server-side delivery and the
 * administrator must still see it.
 *
 * Reads go through Payload's real REST handler (the one mounted at
 * `/api/[...slug]`, wrapped in the launch gate's REST guard), so this is
 * what an anonymous or an administrator HTTP client gets, not a model of it.
 *
 * Only `example.invalid` addresses are written. The original row is put back
 * afterwards.
 *
 * Run with `pnpm test:db` against a marked disposable database.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { env } from '@/lib/env'
import { openDisposableDatabase } from '@/lib/testing/disposable-database'
import type { SiteSetting, User } from '@/payload-types'

const guard = await openDisposableDatabase(env.DATABASE_URL)
const RUN = `ss-${Date.now()}`

const CONTACT = `kontakt-${RUN}@example.invalid`
const NOTIFY = `notify-${RUN}@example.invalid`
const ADMIN_EMAIL = `admin-${RUN}@example.invalid`
// Any origin will do: the reads authenticate by header, not by cookie.
const ORIGIN = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3000'

let payload: Payload
let original: SiteSetting
let admin: User
let adminToken: string
let restGet: (
  request: Request,
  args: { params: Promise<{ slug: string[] }> },
) => Promise<Response>

const get = async (path: string, headers: Record<string, string> = {}) => {
  const slug =
    path
      .replace(/^\/api\//, '')
      .split('?')[0]
      ?.split('/') ?? []
  const response = await restGet(new Request(`${ORIGIN}${path}`, { headers }), {
    params: Promise.resolve({ slug }),
  })
  return { response, text: await response.text() }
}

before(async () => {
  payload = await getPayload({ config })

  original = (await payload.findGlobal({
    slug: 'site-settings',
    depth: 0,
    overrideAccess: true,
  })) as SiteSetting

  await payload.updateGlobal({
    slug: 'site-settings',
    data: { contactEmail: CONTACT, notificationEmail: NOTIFY },
    overrideAccess: true,
  })

  const password = `pw-${RUN}-${Math.random().toString(36).slice(2)}`
  admin = (await payload.create({
    collection: 'users',
    data: { email: ADMIN_EMAIL, password, name: 'Fixture administrator' },
    overrideAccess: true,
  })) as User

  const login = await payload.login({
    collection: 'users',
    data: { email: ADMIN_EMAIL, password },
  })
  adminToken = login.token ?? ''
  assert.ok(adminToken.length > 0)

  // Imported here, after the database guard, so nothing initialises
  // against an unverified target.
  const routes = await import('@/app/(payload)/api/[...slug]/route')
  restGet = routes.GET as typeof restGet
})

after(async () => {
  try {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: {
        contactEmail: original.contactEmail,
        notificationEmail: original.notificationEmail ?? null,
      },
      overrideAccess: true,
    })
    if (admin) {
      await payload.delete({
        collection: 'users',
        id: admin.id,
        overrideAccess: true,
      })
    }
  } finally {
    await guard.end()
    await payload.destroy()
  }
})

describe('site settings over REST', () => {
  it('serves the public fields to an anonymous client, without the notification address', async () => {
    const { response, text } = await get('/api/globals/site-settings')

    // PRIVATE refuses anonymous REST reads altogether; every other mode
    // serves the public global. Either way the address must not appear.
    assert.ok(
      !text.includes(NOTIFY),
      'anonymous REST read exposes notificationEmail',
    )

    if (env.LAUNCH_MODE !== 'PRIVATE') {
      assert.equal(response.status, 200)
      const body = JSON.parse(text) as Partial<SiteSetting>
      assert.equal(body.contactEmail, CONTACT)
      assert.equal('notificationEmail' in body, false)
      assert.ok(body.helpline?.phone)
    } else {
      assert.equal(response.status, 503)
    }

    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  })

  it('does not expose it through query variations either', async () => {
    for (const path of [
      '/api/globals/site-settings?depth=0',
      '/api/globals/site-settings?depth=2',
      '/api/globals/site-settings?select[notificationEmail]=true',
      '/api/globals/site-settings?draft=true',
      '/api/globals/site-settings?locale=cs',
    ]) {
      const { text } = await get(path)
      assert.ok(!text.includes(NOTIFY), path)
    }
  })

  it('reports the field as unreadable in the anonymous permission map', async () => {
    const { text } = await get('/api/access')
    assert.ok(!text.includes(NOTIFY))

    if (env.LAUNCH_MODE !== 'PRIVATE') {
      const access = JSON.parse(text) as {
        globals?: Record<
          string,
          { fields?: Record<string, { read?: boolean }> }
        >
      }
      const field = access.globals?.['site-settings']?.fields?.notificationEmail
      assert.notEqual(field?.read, true)
    }
  })

  it('serves the full settings, notification address included, to an administrator', async () => {
    const { response, text } = await get('/api/globals/site-settings', {
      authorization: `JWT ${adminToken}`,
    })

    assert.equal(response.status, 200)
    const body = JSON.parse(text) as Partial<SiteSetting>
    assert.equal(body.notificationEmail, NOTIFY)
    assert.equal(body.contactEmail, CONTACT)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  })
})

describe('site settings on the server', () => {
  it('still gives the contact form its delivery address (Local API, no user)', async () => {
    // Exactly the read `loadSiteSettings` makes for the contact form.
    const row = (await payload.findGlobal({
      slug: 'site-settings',
      depth: 0,
      overrideAccess: false,
    })) as SiteSetting

    assert.equal(row.notificationEmail, NOTIFY)
    assert.equal(row.contactEmail, CONTACT)
  })

  it('hides it from an access-checked read that did not come through the Local API', async () => {
    const row = (await payload.findGlobal({
      slug: 'site-settings',
      depth: 0,
      overrideAccess: false,
      req: { payloadAPI: 'REST' },
    })) as Partial<SiteSetting>

    assert.equal(row.notificationEmail, undefined)
    assert.equal(row.contactEmail, CONTACT)
  })

  it('lets an administrator update it', async () => {
    const changed = `changed-${RUN}@example.invalid`

    const updated = (await payload.updateGlobal({
      slug: 'site-settings',
      data: { notificationEmail: changed },
      overrideAccess: false,
      user: admin,
    })) as SiteSetting

    assert.equal(updated.notificationEmail, changed)

    await payload.updateGlobal({
      slug: 'site-settings',
      data: { notificationEmail: NOTIFY },
      overrideAccess: true,
    })
  })
})
