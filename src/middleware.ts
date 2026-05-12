import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { routing } from '@/i18n/routing'

const intlMiddleware = createMiddleware(routing)

// Routes that require authentication
const PROTECTED_PATHS = ['/dashboard', '/dashboard/billing']

// Routes that require admin role (checked in layout/page server components)
const ADMIN_PATHS = ['/admin']

// Routes that should redirect authenticated users
const AUTH_PATHS = ['/login', '/prihlaseni', '/prihlasenie', '/register', '/registrace', '/registracia']

function getPathnameWithoutLocale(pathname: string): string {
  const locales = ['cs', 'en', 'sk']
  for (const locale of locales) {
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
    if (pathname === `/${locale}`) return '/'
  }
  return pathname
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // Skip static files, API routes and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/static') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Forward Supabase auth code to the callback handler
  // (Supabase sometimes redirects to Site URL + ?code= instead of the callback path)
  const code = searchParams.get('code')
  if (code) {
    const callbackUrl = new URL('/api/auth/callback', request.url)
    callbackUrl.searchParams.set('code', code)
    const next = searchParams.get('next')
    if (next) callbackUrl.searchParams.set('next', next)
    return NextResponse.redirect(callbackUrl)
  }

  const cleanPath = getPathnameWithoutLocale(pathname)

  // Handle Supabase session refresh
  const { supabaseResponse, user } = await updateSession(request)

  // Check if path requires auth
  const requiresAuth = PROTECTED_PATHS.some((p) => cleanPath.startsWith(p))
  const requiresAdmin = ADMIN_PATHS.some((p) => cleanPath.startsWith(p))
  const isAuthPage = AUTH_PATHS.some((p) => cleanPath.startsWith(p))

  // Determine locale from pathname
  let locale = 'cs'
  const localeMatch = pathname.match(/^\/(cs|en|sk)(\/|$)/)
  if (localeMatch) locale = localeMatch[1]

  // Redirect to login if protected and not authenticated
  if ((requiresAuth || requiresAdmin) && !user) {
    const loginUrl = new URL(`/${locale}/prihlaseni`, request.url)
    if (locale === 'en') loginUrl.pathname = `/${locale}/login`
    if (locale === 'sk') loginUrl.pathname = `/${locale}/prihlasenie`
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users away from auth pages
  if (isAuthPage && user) {
    const redirectUrl = new URL(`/${locale}/dashboard`, request.url)
    return NextResponse.redirect(redirectUrl)
  }

  // Run next-intl middleware
  const intlResponse = intlMiddleware(request)

  // Merge cookies from supabase response into intl response
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    intlResponse.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    })
  })

  return intlResponse
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}
