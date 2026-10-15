import type { CollectionBeforeOperationHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin, isPublic } from '@/lib/access'
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  looksLikeSvg,
  sniffImageMimeType,
} from '@/lib/uploads/image-signature'

/**
 * Reject anything that is not a genuine JPEG / PNG / WebP / AVIF.
 *
 * Runs before Payload processes or stores the file. Checks the bytes, not the
 * filename and not the client-declared Content-Type — both are trivially
 * forged. SVG is called out explicitly because it is the format people
 * actually try, and because an SVG on our media origin executes script.
 */
const enforceImageAllowList: CollectionBeforeOperationHook = ({
  args,
  operation,
  req,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return args
  }

  const file = req.file

  if (!file) {
    // No file on this request (e.g. editing the `alt` text of an existing doc).
    return args
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new APIError(
      `File is too large. Maximum size is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      400,
    )
  }

  const buffer = file.data

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new APIError('Uploaded file could not be read.', 400)
  }

  if (looksLikeSvg(buffer)) {
    throw new APIError(
      'SVG uploads are not allowed. Upload a JPG, PNG, WebP or AVIF image.',
      400,
    )
  }

  const detected = sniffImageMimeType(buffer)

  if (!detected) {
    throw new APIError(
      'Unsupported image format. Allowed formats: JPG, PNG, WebP, AVIF.',
      400,
    )
  }

  // Normalise the stored mimetype to what the bytes actually are, so a forged
  // Content-Type never reaches the database or the CDN response headers.
  req.file = { ...file, mimetype: detected }

  return args
}

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'alt', 'mimeType', 'filesize', 'updatedAt'],
  },
  access: {
    // Media is served publicly from the CDN — read is intentionally open.
    read: isPublic,
    // Everything that mutates requires an authenticated admin.
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  upload: {
    // First gate: restricts the file picker and Payload's own check. The
    // byte-level check in the hook above is what actually enforces this.
    mimeTypes: [...ALLOWED_IMAGE_MIME_TYPES],
    // Files live in R2, never on the (ephemeral) serverless filesystem.
    disableLocalStorage: true,
    // Keep Payload's block on known-problematic types (SVG, HTML, scripts).
    allowRestrictedFileTypes: false,
    // No server-side fetching of arbitrary remote URLs.
    pasteURL: false,
    crop: true,
    focalPoint: false,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: {
        description:
          'Alternative text for screen readers. Describe the image; leave empty-looking decoration out of the media library.',
      },
    },
  ],
  hooks: {
    beforeOperation: [enforceImageAllowList],
  },
  timestamps: true,
}
