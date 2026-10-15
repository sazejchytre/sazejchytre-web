import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Sázej chytře',
    template: '%s · Sázej chytře',
  },
  description:
    'Analytický servis pro sportovní sázení. Informační analýza — nepřijímáme sázky.',
  robots: {
    // Nothing public has shipped yet. Flip this in the step that adds real
    // pages, not before.
    index: false,
    follow: false,
  },
}

export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  )
}
