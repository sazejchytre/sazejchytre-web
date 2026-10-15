/**
 * Passwords that are rejected outright because attackers try them first.
 *
 * HOW THIS LIST IS CURATED, AND WHY IT LOOKS ODD
 *
 * The minimum length is 12 characters, and `checkPassword` tests length BEFORE
 * this list. So the entries that actually do work are the ones at least 12
 * characters long: `password1234`, `qwertyuiop123`, `123456789012`. The short
 * classics (`password`, `123456`) are unreachable through the policy today and
 * are kept anyway, because they cost nothing and the list must stay correct if
 * the minimum ever changes.
 *
 * That is the opposite of how these lists are usually assembled. A generic
 * "top 10 000" is mostly short strings that a 12-character minimum already
 * rejects, so it would add weight without adding protection. What earns its
 * place here is:
 *
 *   - long keyboard walks and digit runs, which are how people reach 12
 *     characters without thinking;
 *   - a common short password with padding — `password1234`, `heslo1234567` —
 *     which is the single most popular way to satisfy a length rule;
 *   - Czech words and phrases, because the audience is Czech and an
 *     English-only list misses `heslo`, `slunicko`, `fotbalek` entirely;
 *   - anything derived from this site or product, which is always among the
 *     first guesses against a specific target.
 *
 * Entries are stored pre-normalised: NFKC, trimmed, lower-cased, matching
 * `normaliseForComparison`. A `Set` gives O(1) lookup, and the whole thing is
 * a few kilobytes.
 *
 * This is a floor, not a ceiling. It stops the passwords that get guessed
 * first; it does not make a weak-but-unlisted password strong. Rate limiting
 * and the lockout in `src/lib/auth/rate-limit.ts` are what bound the rest.
 */

const ENTRIES: readonly string[] = [
  /* --- digit runs and repeats ------------------------------------------- */
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '12345678901',
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789012345',
  '1234512345',
  '123123123123',
  '111111111111',
  '000000000000',
  '121212121212',
  '112233445566',
  '123321123321',
  '147258369147',
  '987654321098',
  '098765432109',
  '00000000',
  '11111111',
  '99999999',

  /* --- keyboard walks --------------------------------------------------- */
  'qwertyuiop',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwertyuiop[]',
  'qwertyuiopasdfghjkl',
  'asdfghjkl',
  'asdfghjkl123',
  'asdfghjklzxcvbnm',
  'zxcvbnm123456',
  'qwertzuiop',
  'qwertzuiop12',
  'qwertzuiopasdfghjkl',
  'yxcvbnm123456',
  '1qaz2wsx3edc',
  '1qaz2wsx3edc4rfv',
  'qazwsxedcrfv',
  'qwer1234qwer',
  'qweasdzxc123',
  'q1w2e3r4t5y6',
  '1q2w3e4r5t6y',
  'zaqwsxcde321',

  /* --- English classics, padded to length ------------------------------- */
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'password12345',
  'password123456',
  'password!234',
  'password@123',
  'passw0rd1234',
  'p@ssw0rd1234',
  'passwordpassword',
  'letmein12345',
  'letmein123456',
  'welcome12345',
  'welcome123456',
  'iloveyou1234',
  'iloveyou12345',
  'sunshine1234',
  'princess1234',
  'football1234',
  'baseball1234',
  'superman1234',
  'trustno1234567',
  'whatever1234',
  'starwars1234',
  'dragon123456',
  'monkey123456',
  'master123456',
  'shadow123456',
  'qwerty123456',
  'abc123456789',
  'admin1234567',
  'administrator',
  'administrator123',
  'changeme1234',
  'secret123456',
  'temporary123',
  'default12345',
  'thisismypassword',
  'mypasswordis123',
  'correcthorsebatterystaple',

  /* --- Czech: the words people actually pick ----------------------------- */
  // `heslo` is simply "password"; the padded forms are the Czech equivalent of
  // `password123` and are guessed just as early.
  'heslo',
  'heslo123',
  'heslo1234',
  'heslo12345',
  'heslo123456',
  'heslo1234567',
  'hesloheslo',
  'hesloheslo12',
  'mojeheslo123',
  'mojetajneheslo',
  'tajneheslo123',
  'nemamheslo12',
  'zapomneljsem',
  'slunicko1234',
  'slunicko12345',
  'kyticka12345',
  'miminko12345',
  'pejsek123456',
  'kocicka12345',
  'motylek12345',
  'fotbalek1234',
  'hokejista123',
  'sparta123456',
  'slavia123456',
  'banik1234567',
  'viktorka1234',
  'ceskarepublika',
  'ceskarepublika1',
  'praha1234567',
  'praha123456789',
  'brno12345678',
  'ostrava12345',
  'olomouc12345',
  'pardubice123',
  'budejovice12',
  'jaromir68123',
  'honzicek1234',
  'pepicek12345',
  'maminka12345',
  'tatinek12345',
  'babicka12345',
  'dedecek12345',
  'milujutebe12',
  'milujuteberad',
  'nevimheslo12',
  'dobrydenjak',
  'ahojsvete123',
  'pivopivopivo',
  'pivecko12345',
  'knedliky1234',
  'svickova1234',
  'vanoce123456',
  'velikonoce12',
  'kveten123456',
  'leden1234567',
  'prosinec1234',

  /* --- derived from this site or product -------------------------------- */
  // Always among the first guesses against a named target.
  'sazejchytre',
  'sazejchytre1',
  'sazejchytre12',
  'sazejchytre123',
  'sazejchytre1234',
  'sazejchytre.cz',
  'sazejchytrecz',
  'sazejchytreheslo',
  'sazejchytre2026',
  'sazejchytre2027',
  'sazejchytreadmin',
  'sazejchytrepro',
  'sazejchytreinsider',
  'sazejchytrestart',
  'tipysazky1234',
  'sazkykurzy123',
  'sportsazeni12',

  /* --- years and dates appended to anything ----------------------------- */
  'leden2026abc',
  'password2026',
  'password2027',
  'heslo2026abc',
  'heslo2026heslo',
  'jaro2026jaro',
  '01011990abcd',
  '31121999abcd',

  /* --- "random-looking" strings that are not random --------------------- */
  'aaaaaaaaaaaa',
  'abcdefghijkl',
  'abcdefghijklmnop',
  'zyxwvutsrqpo',
  'asdasdasdasd',
  'qweqweqweqwe',
  'testtesttest',
  'test123456789',
  'demo123456789',
  'guest12345678',
  'user123456789',
  'login12345678',
  'nothing12345',
  'whocares1234',
  'idontknow123',
  'nevertellyou',
]

/**
 * Pre-normalised lookup set.
 *
 * Built once at module load. Entries are normalised here rather than trusted
 * to be written correctly above, so a stray capital or space in the list
 * cannot create a silent hole.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  ENTRIES.map((entry) => entry.normalize('NFKC').trim().toLowerCase()),
)

/** Exposed for the test that guards against accidental shrinkage. */
export const COMMON_PASSWORD_COUNT = COMMON_PASSWORDS.size
