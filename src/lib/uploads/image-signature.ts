/**
 * Content-based image type detection.
 *
 * The browser-supplied `Content-Type` and the file extension are both attacker
 * controlled. `evil.svg` renamed to `cat.png` and sent as `image/png` passes
 * every extension check there is — and an SVG served from our own media origin
 * is a stored-XSS primitive. So we read the actual bytes.
 *
 * Only the four raster formats the product needs are recognised. Anything
 * unrecognised is rejected; there is no "allow unknown" branch on purpose.
 */

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number]

/** Maximum accepted upload size: 5 MB, in bytes. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

/** ISO-BMFF brands that indicate AVIF. HEIC brands are deliberately absent. */
const AVIF_BRANDS = new Set(['avif', 'avis'])

function ascii(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString('latin1')
}

function isJpeg(buffer: Buffer): boolean {
  // SOI marker followed by any marker byte.
  return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && PNG_SIGNATURE.equals(buffer.subarray(0, 8))
}

function isWebp(buffer: Buffer): boolean {
  // RIFF container whose form type is WEBP.
  return (
    buffer.length >= 12 &&
    ascii(buffer, 0, 4) === 'RIFF' &&
    ascii(buffer, 8, 12) === 'WEBP'
  )
}

function isAvif(buffer: Buffer): boolean {
  // ISO base media file format: [size:4][ 'ftyp' ][major:4][minor:4][compat...]
  if (buffer.length < 12 || ascii(buffer, 4, 8) !== 'ftyp') {
    return false
  }

  if (AVIF_BRANDS.has(ascii(buffer, 8, 12))) {
    return true
  }

  // Some encoders write major brand `mif1` and list `avif` as a compatible
  // brand instead. Scan the compatible-brand list, bounded by the box size and
  // a hard cap so a hostile header cannot make us walk the whole file.
  const declaredBoxSize = buffer.readUInt32BE(0)
  const limit = Math.min(
    buffer.length,
    declaredBoxSize > 16 ? declaredBoxSize : buffer.length,
    512,
  )

  for (let offset = 16; offset + 4 <= limit; offset += 4) {
    if (AVIF_BRANDS.has(ascii(buffer, offset, offset + 4))) {
      return true
    }
  }

  return false
}

/**
 * True when the payload is (or claims to be) SVG.
 *
 * Only used to produce a precise error message — SVG fails the allow-list
 * regardless, because it matches none of the raster signatures above.
 */
export function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer
    .subarray(0, 1024)
    .toString('utf8')
    .replace(/^\ufeff/, '') // strip BOM
    .trimStart()
    .toLowerCase()

  if (head.startsWith('<svg') || head.startsWith('<!doctype svg')) {
    return true
  }

  return head.startsWith('<?xml') && head.includes('<svg')
}

/**
 * Detect the real image type from the leading bytes.
 *
 * @returns the detected MIME type, or `null` if it is not an allowed raster image.
 */
export function sniffImageMimeType(
  buffer: Buffer,
): AllowedImageMimeType | null {
  if (buffer.length < 12) {
    return null
  }

  if (isJpeg(buffer)) return 'image/jpeg'
  if (isPng(buffer)) return 'image/png'
  if (isWebp(buffer)) return 'image/webp'
  if (isAvif(buffer)) return 'image/avif'

  return null
}
