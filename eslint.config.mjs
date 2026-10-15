import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'build/**',
      'out/**',
      // Generated files — regenerated wholesale, not hand-edited.
      'src/payload-types.ts',
      'src/app/(payload)/admin/importMap.js',
      'src/migrations/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      // Unused code is a bug or dead weight; `_`-prefixed names are the escape
      // hatch for required-but-unused parameters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      /*
       * Guard the server/client secret boundary.
       *
       * `@/lib/env` holds secrets. It throws if it ever executes in a browser,
       * but a lint error at authoring time is a far better signal than a
       * runtime crash. Client code must use `@/lib/env.public`.
       */
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/env',
              message:
                'Server secrets. Allowed in payload.config.ts, collections and route handlers only. Client code must import `publicEnv` from "@/lib/env.public".',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  {
    // Files that legitimately own the server environment.
    files: [
      'src/payload.config.ts',
      'src/lib/env.ts',
      'src/collections/**/*.ts',
      'src/app/**/route.ts',
      'next.config.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // Must stay last: turns off every rule that fights Prettier.
  eslintConfigPrettier,
)
