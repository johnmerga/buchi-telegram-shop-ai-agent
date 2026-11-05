import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ioPackages = ['pg', 'postgres', 'drizzle-orm', 'express', 'grammy', '@google/genai'];

const crossModuleRepo = {
  regex: '^\\.\\./(\\.\\./modules/)?[^/]+/[^/]+\\.repo$',
  message: "Call the other module's service instead of its repo.",
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    ...reactHooks.configs.flat.recommended,
  },
  {
    // Modules talk to each other through services, never through another module's repo.
    files: ['apps/server/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [crossModuleRepo] }],
    },
  },
  {
    // Domain files hold pure logic: no I/O and no infrastructure.
    files: ['**/*.domain.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ioPackages,
          patterns: [
            crossModuleRepo,
            {
              regex:
                '(\\.(repo|service|routes|handlers)$)|(/(db|integrations|http|telegram)(/|$))|^drizzle-orm/',
              message: 'Domain files must stay pure. Move I/O to a service or repo.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
