import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAX_UPLOAD_BYTES,
  looksLikeSvg,
  sniffImageMimeType,
} from './image-signature.ts'

/**
 * These assertions are the actual guarantee behind "SVG uploads are rejected".
 * The Payload hook is a thin wrapper around `sniffImageMimeType`; if this file
 * passes, a renamed or mislabelled SVG cannot get through.
 */

/** Pad a header out so it clears the 12-byte minimum length check. */
const withPadding = (header: number[]): Buffer =>
  Buffer.concat([Buffer.from(header), Buffer.alloc(64)])

const JPEG = withPadding([0xff, 0xd8, 0xff, 0xe0])
const PNG = withPadding([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
  Buffer.alloc(32),
])

const avifWithBrands = (major: string, compatible: string[] = []): Buffer => {
  const body = Buffer.concat([
    Buffer.from('ftyp', 'latin1'),
    Buffer.from(major, 'latin1'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // minor version
    Buffer.from(compatible.join(''), 'latin1'),
  ])
  const size = Buffer.alloc(4)
  size.writeUInt32BE(body.length + 4)
  return Buffer.concat([size, body, Buffer.alloc(16)])
}

describe('sniffImageMimeType', () => {
  it('accepts the four allowed raster formats', () => {
    assert.equal(sniffImageMimeType(JPEG), 'image/jpeg')
    assert.equal(sniffImageMimeType(PNG), 'image/png')
    assert.equal(sniffImageMimeType(WEBP), 'image/webp')
    assert.equal(sniffImageMimeType(avifWithBrands('avif')), 'image/avif')
  })

  it('accepts AVIF declared only via a compatible brand', () => {
    const buffer = avifWithBrands('mif1', ['mif1', 'avif'])
    assert.equal(sniffImageMimeType(buffer), 'image/avif')
  })

  it('rejects HEIC, which shares the AVIF container', () => {
    const heic = avifWithBrands('heic', ['mif1', 'heic'])
    assert.equal(sniffImageMimeType(heic), null)
  })

  it('rejects an SVG no matter what it is called', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'utf8',
    )
    assert.equal(sniffImageMimeType(svg), null)
    assert.equal(looksLikeSvg(svg), true)
  })

  it('rejects an XML-prologue SVG and a leading-whitespace SVG', () => {
    const prologue = Buffer.from(
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
      'utf8',
    )
    const padded = Buffer.from('\n\n   <SVG xmlns="x"/>', 'utf8')

    assert.equal(looksLikeSvg(prologue), true)
    assert.equal(looksLikeSvg(padded), true)
    assert.equal(sniffImageMimeType(prologue), null)
    assert.equal(sniffImageMimeType(padded), null)
  })

  it('rejects a GIF, a PDF and an ELF binary', () => {
    assert.equal(
      sniffImageMimeType(withPadding([...Buffer.from('GIF89a')])),
      null,
    )
    assert.equal(
      sniffImageMimeType(withPadding([...Buffer.from('%PDF-1.7')])),
      null,
    )
    assert.equal(
      sniffImageMimeType(withPadding([0x7f, 0x45, 0x4c, 0x46])),
      null,
    )
  })

  it('rejects a truncated or empty buffer', () => {
    assert.equal(sniffImageMimeType(Buffer.alloc(0)), null)
    assert.equal(sniffImageMimeType(Buffer.from([0xff, 0xd8, 0xff])), null)
  })

  it('does not mistake a RIFF container that is not WebP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVEfmt ', 'latin1'),
      Buffer.alloc(16),
    ])
    assert.equal(sniffImageMimeType(wav), null)
  })

  it('does not flag a real PNG as SVG', () => {
    assert.equal(looksLikeSvg(PNG), false)
  })
})

describe('MAX_UPLOAD_BYTES', () => {
  it('is 5 MB', () => {
    assert.equal(MAX_UPLOAD_BYTES, 5 * 1024 * 1024)
  })
})
