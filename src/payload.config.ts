import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { AuthLockouts } from '@/collections/auth/AuthLockouts'
import { Competitions } from '@/collections/tips/Competitions'
import { SportingEvents } from '@/collections/tips/SportingEvents'
import { Sports } from '@/collections/tips/Sports'
import { TipAuditEvents } from '@/collections/tips/TipAuditEvents'
import { TipSelections } from '@/collections/tips/TipSelections'
import { Tips } from '@/collections/tips/Tips'
import { BillingProviderRefs } from '@/collections/billing/BillingProviderRefs'
import { ConsentRecords } from '@/collections/billing/ConsentRecords'
import { CreditNotes } from '@/collections/billing/CreditNotes'
import { Disputes } from '@/collections/billing/Disputes'
import { Customers } from '@/collections/billing/Customers'
import { EntitlementGrants } from '@/collections/billing/EntitlementGrants'
import { Invoices } from '@/collections/billing/Invoices'
import { Plans } from '@/collections/billing/Plans'
import { Prices } from '@/collections/billing/Prices'
import { SubscriptionEvents } from '@/collections/billing/SubscriptionEvents'
import { Subscriptions } from '@/collections/billing/Subscriptions'
import { WebhookEvents } from '@/collections/billing/WebhookEvents'
import { Media } from '@/collections/Media'
import { Users } from '@/collections/Users'
import { applyBillingSchemaOverrides } from '@/lib/billing/schema'
import { env, isDevelopment } from '@/lib/env'
import { publicEnv } from '@/lib/env.public'
import { MAX_UPLOAD_BYTES } from '@/lib/uploads/image-signature'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const serverUrl = publicEnv.NEXT_PUBLIC_SERVER_URL

/**
 * Origins allowed to talk to the Payload API.
 *
 * Production gets exactly one origin. localhost is added only in development —
 * a `localhost` entry on a production CORS allow-list is a real hole when
 * combined with a DNS-rebinding or malicious-local-app scenario.
 */
const allowedOrigins = Array.from(
  new Set([
    serverUrl,
    ...(isDevelopment
      ? ['http://localhost:3000', 'http://127.0.0.1:3000']
      : []),
  ]),
)

export default buildConfig({
  serverURL: serverUrl,

  admin: {
    user: Users.slug,
    // Panel lives at /admin.
    importMap: {
      baseDir: path.resolve(dirname, '..'),
    },
    meta: {
      titleSuffix: '· Sázej chytře',
    },
  },

  collections: [
    Users,
    Media,

    // Billing domain. Order is presentational only; relationships are resolved
    // by slug, so it does not encode dependencies.
    Plans,
    Prices,
    Customers,
    BillingProviderRefs,
    Subscriptions,
    SubscriptionEvents,
    EntitlementGrants,
    Invoices,
    CreditNotes,
    Disputes,
    ConsentRecords,
    WebhookEvents,

    // Customer-auth support records. better-auth owns the `auth` schema; this
    // is our own durable history of lockouts, in `public`.
    AuthLockouts,

    // Tips and the track record. Sports and events first so the admin panel
    // lists them in the order they are filled in.
    Sports,
    Competitions,
    SportingEvents,
    Tips,
    TipSelections,
    TipAuditEvents,
  ],

  db: postgresAdapter({
    pool: {
      connectionString: env.DATABASE_URL,
    },
    // Migrations are explicit and reviewed — never let a deploy mutate the
    // schema on its own.
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
    /**
     * Forces money columns to `integer` and adds the partial unique index that
     * allows only one active price per plan + currency + interval.
     *
     * Payload maps `type: 'number'` to `numeric`, an arbitrary-precision
     * DECIMAL type. Without this hook the database would itself accept
     * fractional money, no matter what the application validated. Runs before
     * migration generation, so both changes ship in the migration.
     */
    afterSchemaInit: [applyBillingSchemaOverrides],
  }),

  editor: lexicalEditor(),

  // GraphQL is disabled: it is unused, and every enabled endpoint is attack
  // surface plus an introspection target.
  graphQL: {
    disablePlaygroundInProduction: true,
    disable: true,
  },

  cors: {
    origins: allowedOrigins,
  },
  csrf: allowedOrigins,

  // Global upload ceiling, enforced before the request body is buffered.
  // Media re-checks the real size in its own hook.
  upload: {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
    },
  },

  plugins: [
    s3Storage({
      collections: {
        media: {
          prefix: 'media',
          // Serve straight from the public R2 domain rather than proxying
          // every byte through a serverless function.
          disablePayloadAccessControl: true,
          generateFileURL: ({ filename, prefix }) =>
            [env.R2_PUBLIC_BASE_URL, prefix, filename]
              .filter(Boolean)
              .join('/'),
        },
      },
      bucket: env.R2_BUCKET,
      config: {
        // R2 is S3-compatible but has no regions.
        region: 'auto',
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      },
    }),
  ],

  secret: env.PAYLOAD_SECRET,

  sharp,

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },

  telemetry: false,
})
