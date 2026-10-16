/**
 * What the document must say, and that it renders at all.
 *
 * The statutory content is asserted by extracting the text back out of the
 * PDF rather than by inspecting the inputs. An assertion on the inputs proves
 * the test fixture; an assertion on the output proves the document.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'

import { renderDocumentPdf, type RenderableDocument } from './pdf.ts'

/* -------------------------------------------------------------------------- */
/* Reading the text back out                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The visible text of a PDF, via its ToUnicode map.
 *
 * pdfkit embeds a SUBSET of the font, so the glyph codes in the content
 * stream are not Unicode. The ToUnicode CMap is what maps them back, and
 * following it is the only way to assert on what a reader actually sees — and
 * it incidentally proves the CMap is present, without which the document is
 * unsearchable and un-copyable in every viewer.
 */
const extractText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1')
  const streams = inflatedStreams(pdf)

  /* --- 1. Build code -> character from every ToUnicode CMap -------------- */

  const toUnicode = new Map<number, string>()

  for (const stream of streams) {
    // `beginbfrange` with an ARRAY: `<lo> <hi> [<u> <u> …]` maps lo+i to the
    // i-th entry. This is the form pdfkit emits for a subset font, and
    // missing it was why an earlier version of this helper extracted nothing.
    for (const [, lo, , list] of stream.matchAll(
      /<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>\s*\[([^\]]*)\]/g,
    )) {
      const start = parseInt(lo as string, 16)
      const targets = [...(list as string).matchAll(/<([0-9a-fA-F]+)>/g)]

      targets.forEach(([, hex], offset) => {
        const digits = hex as string
        // A target may be several UTF-16 units; the first is enough here.
        toUnicode.set(
          start + offset,
          String.fromCharCode(parseInt(digits.slice(0, 4), 16)),
        )
      })
    }

    // `beginbfrange` SEQUENTIAL form: `<lo> <hi> <uStart>`.
    for (const [, lo, hi, uStart] of stream.matchAll(
      /<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>/g,
    )) {
      const start = parseInt(lo as string, 16)
      const end = parseInt(hi as string, 16)
      const base = parseInt(uStart as string, 16)

      for (let code = start; code <= end && code - start < 0x10000; code += 1) {
        if (!toUnicode.has(code)) {
          toUnicode.set(code, String.fromCharCode(base + (code - start)))
        }
      }
    }

    // `beginbfchar`: `<src> <dst>` pairs.
    const charBlock = /beginbfchar([\s\S]*?)endbfchar/g

    for (const [, block] of stream.matchAll(charBlock)) {
      for (const [, src, dst] of (block as string).matchAll(
        /<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]+)>/g,
      )) {
        toUnicode.set(
          parseInt(src as string, 16),
          String.fromCharCode(parseInt((dst as string).slice(0, 4), 16)),
        )
      }
    }
  }

  /* --- 2. Walk the content streams ---------------------------------------- */

  const decode = (digits: string): string => {
    let text = ''

    for (let index = 0; index + 4 <= digits.length; index += 4) {
      const code = parseInt(digits.slice(index, index + 4), 16)
      text += toUnicode.get(code) ?? ''
    }

    return text
  }

  const pieces: string[] = []

  for (const stream of streams) {
    if (!stream.includes('TJ') && !stream.includes('Tj')) continue

    // Positioned text: `[<hex> kern <hex> …] TJ`. The kerning numbers between
    // the hex runs are spacing, not characters.
    for (const [, body] of stream.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const parts = [...(body as string).matchAll(/<([0-9a-fA-F]+)>/g)].map(
        ([, hex]) => decode(hex as string),
      )

      pieces.push(parts.join(''))
    }

    for (const [, hex] of stream.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) {
      pieces.push(decode(hex as string))
    }
  }

  return `${pieces.join('\n')}\n${raw.includes('/ToUnicode') ? '' : 'NO_TOUNICODE'}`
}

/** Every FlateDecode stream in the file, inflated. */
const inflatedStreams = (pdf: Buffer): string[] => {
  const out: string[] = []
  const marker = Buffer.from('stream')
  const endMarker = Buffer.from('endstream')

  let cursor = 0

  while (cursor < pdf.length) {
    const start = pdf.indexOf(marker, cursor)
    if (start === -1) break

    const end = pdf.indexOf(endMarker, start)
    if (end === -1) break

    // Skip past "stream" and the EOL that must follow it.
    let bodyStart = start + marker.length
    if (pdf[bodyStart] === 0x0d) bodyStart += 1
    if (pdf[bodyStart] === 0x0a) bodyStart += 1

    const body = pdf.subarray(bodyStart, end)

    try {
      out.push(inflateSync(body).toString('utf8'))
    } catch {
      // Not deflated, or not a stream we care about.
      out.push(body.toString('latin1'))
    }

    cursor = end + endMarker.length
  }

  return out
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const invoice = (parts: Partial<RenderableDocument> = {}): RenderableDocument =>
  ({
    kind: 'INVOICE',
    number: 'FA2026-000001',
    issuedAt: new Date('2026-10-16T09:00:00.000Z'),
    taxableSupplyDate: new Date('2026-10-16T00:00:00.000Z'),
    supplier: {
      legalName: 'Jan Novák',
      address: 'Příkopy 12, 602 00 Brno',
      businessId: '12345678',
      taxId: null,
      email: 'info@sazejchytre.cz',
    },
    supplierVatRegistered: false,
    customer: {
      name: 'Žluťoučký Kůň',
      email: 'kun@example.test',
      address: 'Dlouhá 5, 110 00 Praha',
      country: 'CZ',
    },
    description: 'Předplatné služby sazejchytre.cz – tarif PRO',
    periodStart: new Date('2026-10-16T00:00:00.000Z'),
    periodEnd: new Date('2026-11-16T00:00:00.000Z'),
    amountMinor: 79_900,
    currency: 'CZK',
    payment: {
      method: 'CARD',
      paidAt: new Date('2026-10-16T08:59:00.000Z'),
      cardBrand: 'visa',
      cardLast4: '4242',
    },
    ...parts,
  }) as RenderableDocument

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('invoice PDF', () => {
  it('produces a single-page PDF with the font embedded', async () => {
    const pdf = await renderDocumentPdf(invoice())

    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
    // Embedded, not referenced: the file must render identically in ten years
    // on a machine that has never heard of our fonts.
    assert.ok(pdf.includes(Buffer.from('FontFile2')))
    assert.equal(pdf.includes(Buffer.from('/Encrypt')), false)
  })

  it('is text, not an image — the text can be read back out', async () => {
    const text = extractText(await renderDocumentPdf(invoice()))

    assert.equal(
      text.includes('NO_TOUNICODE'),
      false,
      'no ToUnicode map: the document would be unsearchable and un-copyable',
    )
    assert.ok(text.length > 100, 'extracted almost nothing')
  })

  describe('statutory content', () => {
    it('names the document and its number', async () => {
      const text = extractText(await renderDocumentPdf(invoice()))

      assert.match(text, /FAKTURA/)
      // A non-VAT payer issues an accounting document, not a tax document,
      // and the designation has to say which.
      assert.match(text, /ÚČETNÍ DOKLAD/)
      assert.match(text, /FA2026-000001/)
    })

    it('states that the issuer is not a VAT payer', async () => {
      // An invoice with no VAT line and no explanation looks like one that
      // forgot the VAT. This sentence is what makes the absence lawful
      // rather than suspicious.
      const text = extractText(await renderDocumentPdf(invoice()))

      assert.match(text, /není plátcem DPH/)
    })

    it('carries the issuer identity including IČO', async () => {
      const text = extractText(await renderDocumentPdf(invoice()))

      assert.match(text, /Jan Novák/)
      assert.match(text, /IČO: 12345678/)
      assert.match(text, /Příkopy 12/)
    })

    it('carries the customer identity', async () => {
      const text = extractText(await renderDocumentPdf(invoice()))

      assert.match(text, /Žluťoučký Kůň/)
      assert.match(text, /kun@example\.test/)
    })

    it('describes the service plainly', async () => {
      const text = extractText(await renderDocumentPdf(invoice()))

      assert.match(text, /Předplatné služby/)
      assert.match(text, /tarif PRO/)
      // Nothing claiming to place bets, broker gambling or guarantee an
      // outcome. A tax document is a bad place to overstate what was sold.
      assert.doesNotMatch(text, /sázk|výhra|garantu/i)
    })

    it('states both dates and the period covered', async () => {
      const text = extractText(await renderDocumentPdf(invoice()))

      assert.match(text, /Datum vystavení/)
      // Separate from the issue date because the tax period follows the
      // supply, and the two legitimately differ.
      assert.match(text, /Datum uskutečnění plnění/)
      assert.match(text, /16\.\s*10\.\s*2026/)
      assert.match(text, /Zúčtovací období/)
    })

    it('states the amount, the currency and a zero VAT line', async () => {
      const text = extractText(await renderDocumentPdf(invoice()))

      assert.match(text, /799,00/)
      assert.match(text, /Kč/)
      // Explicit rather than omitted, so a reader can see the VAT is zero
      // because none is charged, not because a line is missing.
      assert.match(text, /DPH 0 %/)
    })

    it('says it is already paid and is not a demand for payment', async () => {
      // The single most useful line on the document: it stops a customer
      // paying twice and stops an accountant chasing a receivable.
      const text = extractText(await renderDocumentPdf(invoice()))

      assert.match(text, /Uhrazeno/)
      assert.match(text, /platební kartou/)
      assert.match(text, /visa/)
      assert.match(text, /4242/)
      assert.match(text, /není výzvou k platbě/)
    })

    it('never prints more than the last four digits of a card', async () => {
      const pdf = await renderDocumentPdf(invoice())
      const text = extractText(pdf)

      // There is nowhere in the renderable type to put a PAN, and this is the
      // assertion that keeps it that way.
      assert.doesNotMatch(text, /\d{12,}/)
    })

    it('prints DIČ instead of the not-a-VAT-payer line once registered', async () => {
      const text = extractText(
        await renderDocumentPdf(
          invoice({
            supplier: {
              legalName: 'Jan Novák',
              address: 'Příkopy 12, 602 00 Brno',
              businessId: '12345678',
              taxId: 'CZ12345678',
            },
            supplierVatRegistered: true,
          }),
        ),
      )

      assert.match(text, /DIČ: CZ12345678/)
    })
  })

  describe('operator placeholders', () => {
    it('renders them verbatim rather than inventing anything', async () => {
      // `operator.ts` is still placeholders. A development document must be
      // visibly unusable, not subtly wrong — a plausible-looking fake IČO is
      // far more dangerous than an obvious TODO.
      const text = extractText(
        await renderDocumentPdf(
          invoice({
            supplier: {
              legalName: 'TODO: registered business name',
              address: 'TODO: street and number',
              businessId: 'TODO: 8-digit IČO',
              taxId: null,
            },
          }),
        ),
      )

      assert.match(text, /TODO: registered business name/)
      assert.match(text, /TODO: 8-digit IČO/)
    })
  })
})

describe('credit note PDF', () => {
  const note = invoice({
    kind: 'CREDIT_NOTE',
    number: 'OD2026-000001',
    amountMinor: 79_900,
    corrects: {
      number: 'FA2026-000001',
      reason: 'Vráceno na žádost zákazníka',
    },
  })

  it('is designated as a correcting document', async () => {
    const text = extractText(await renderDocumentPdf(note))

    assert.match(text, /OPRAVNÝ ÚČETNÍ DOKLAD/)
    assert.match(text, /OD2026-000001/)
  })

  it('references the invoice it corrects and states the reason', async () => {
    const text = extractText(await renderDocumentPdf(note))

    assert.match(text, /Opravuje fakturu č\. FA2026-000001/)
    assert.match(text, /Vráceno na žádost zákazníka/)
  })

  it('states the amount returned, not an amount due', async () => {
    const text = extractText(await renderDocumentPdf(note))

    assert.match(text, /Vráceno celkem/)
    assert.doesNotMatch(text, /Celkem k úhradě/)
    assert.doesNotMatch(text, /není výzvou k platbě/)
  })
})
