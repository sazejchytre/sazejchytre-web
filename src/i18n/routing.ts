import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['cs', 'en', 'sk'],
  defaultLocale: 'cs',
  pathnames: {
    '/': '/',
    '/pricing': {
      cs: '/ceniky',
      en: '/pricing',
      sk: '/cennik',
    },
    '/how-it-works': {
      cs: '/jak-to-funguje',
      en: '/how-it-works',
      sk: '/ako-to-funguje',
    },
    '/about': {
      cs: '/o-nas',
      en: '/about',
      sk: '/o-nas',
    },
    '/contact': {
      cs: '/kontakt',
      en: '/contact',
      sk: '/kontakt',
    },
    '/login': {
      cs: '/prihlaseni',
      en: '/login',
      sk: '/prihlasenie',
    },
    '/register': {
      cs: '/registrace',
      en: '/register',
      sk: '/registracia',
    },
    '/dashboard': '/dashboard',
    '/dashboard/billing': '/dashboard/billing',
    '/terms': {
      cs: '/obchodni-podminky',
      en: '/terms',
      sk: '/obchodne-podmienky',
    },
    '/privacy': {
      cs: '/ochrana-osobnich-udaju',
      en: '/privacy',
      sk: '/ochrana-osobnych-udajov',
    },
    '/cookies': '/cookies',
    '/responsible-gambling': {
      cs: '/zodpovedne-sazeni',
      en: '/responsible-gambling',
      sk: '/zodpovedne-sadzanie',
    },
    '/risk-warning': {
      cs: '/upozorneni-na-rizika',
      en: '/risk-warning',
      sk: '/upozornenie-na-rizika',
    },
  },
})
