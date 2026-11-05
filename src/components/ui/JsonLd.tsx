/**
 * A JSON-LD block.
 *
 * `dangerouslySetInnerHTML` is unavoidable here: a JSON-LD block has to be
 * raw text inside a script element, and React would otherwise escape it into
 * something no crawler can parse.
 *
 * What makes that safe is `serialiseJsonLd`, which escapes `<`, `>` and `&`
 * so a database field containing `</script>` cannot close the element early.
 * That function lives in `src/lib/seo/jsonld.ts` and has its own tests —
 * see the note there for why it is not a one-liner in this file.
 */
import type { JsonLdNode } from '@/lib/seo/jsonld'
import { serialiseJsonLd } from '@/lib/seo/jsonld'

export const JsonLd = ({ data }: { data: JsonLdNode }) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: serialiseJsonLd(data) }}
  />
)
