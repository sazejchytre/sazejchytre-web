/**
 * Placeholder landing page.
 *
 * Intentionally minimal — this step is infrastructure only. The real page,
 * design system and content land in later steps.
 *
 * No link to /admin on purpose: there is no reason to advertise the admin
 * entry point from a public page.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold text-neutral-900">Sázej chytře</h1>
      <p className="text-base text-neutral-600">Projekt se připravuje.</p>
    </main>
  )
}
