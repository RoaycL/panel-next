import process from 'node:process'
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    e18e: false,
    ignores: [
      'docker-compose/**',
      'kubernetes/**',
      'service/**',
    ],
    jsdoc: false,
    jsonc: false,
    markdown: false,
    perfectionist: false,
    pnpm: false,
    rules: {
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    },
    stylistic: false,
    unicorn: false,
    yaml: false,
  },
  {
    files: [
      'scripts/**/*.{mjs,js,ts}',
      'add-frontend-version.js',
    ],
    rules: {
      'no-console': 'off',
      // Test scripts run on Node and stub browser objects.
      'accessor-pairs': 'off',
      'no-new-func': 'off',
      'node/prefer-global/buffer': 'off',
    },
  },
  {
    files: ['extension/**/*.{js,mjs}'],
    languageOptions: {
      globals: { chrome: 'readonly' },
    },
  },
)
