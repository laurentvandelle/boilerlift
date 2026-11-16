
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import boundaries from 'eslint-plugin-boundaries';
import stylistic from '@stylistic/eslint-plugin';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';

const noBarrelOrRelative = {
  patterns: [
    {
      group: ['./*', '../*', '../**', './**', '#/*', '#/**'],
      message: 'No relative import: use the #src/ alias (#src/cli/…, #src/core/…).',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'debug/**', 'eslint.config.mts'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.mts'] },
        tsconfigRootDir: new URL('.', import.meta.url).pathname,
      },
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      // Folded from the former .eslintrc.json. SwitchCase 0 keeps the core indent rule's default.
      '@stylistic/indent': ['error', 2, { SwitchCase: 0 }],
      '@stylistic/semi': ['warn', 'always'],
      'no-console': 'warn',
      'no-throw-literal': 'error',
      'no-warning-comments': 'off',
      'no-else-return': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // A directive comment names its rules and gives its reason after `--`. Boundaries and the import rule
    // are never disabled inline: an exception goes in this file.
    plugins: { '@eslint-community/eslint-comments': eslintComments },
    rules: {
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: ['eslint-enable'] }],
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@eslint-community/eslint-comments/no-restricted-disable': [
        'error',
        'boundaries/dependencies',
        'no-restricted-imports',
      ],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', noBarrelOrRelative],
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
      'boundaries/elements': [
        { type: 'cli-command', pattern: 'src/cli/commands/*', capture: ['name'] },
        { type: 'cli', pattern: 'src/cli' },
        { type: 'compile', pattern: 'src/core/compile' },
        { type: 'deliver', pattern: 'src/core/deliver' },
        { type: 'core', pattern: 'src/core' },
      ],
      'boundaries/files': [
        { category: 'test', pattern: '**/*.test.ts' },
        { category: 'cli-model', pattern: 'src/cli/*.model.ts' },
        { category: 'fake', pattern: 'src/**/*.fake.ts' },
        { category: 'bin', pattern: 'src/bin.ts' },
        { category: 'index', pattern: 'src/index.ts' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkAllOrigins: true,
          checkUnknownLocals: true,
          // Also check imports inside one element, so the fake fence below holds within cli/ too.
          checkInternals: true,
          policies: [
            // 1. npm packages and Node core: allowed unless a later policy says otherwise.
            { allow: { to: { module: { origin: ['external', 'core'] } } } },
            // 3. One allow per layer: itself plus the layers it may use.
            // core/compile turns workflow code into n8n JSON. core/deliver pushes it to n8n and may read
            // what compile produces. Other core/ folders are shared helpers that know neither stage.
            {
              from: { element: { type: 'core' } },
              allow: { to: { element: { type: 'core' } } },
            },
            {
              from: { element: { type: 'compile' } },
              allow: { to: { element: { type: ['compile', 'core'] } } },
            },
            {
              from: { element: { type: 'deliver' } },
              allow: { to: { element: { type: ['deliver', 'compile', 'core'] } } },
            },
            {
              // A command sees only itself, the CLI contracts (cli/*.model.ts) and core. Never another command.
              from: { element: { type: 'cli-command' } },
              allow: { to: { element: { type: ['compile', 'deliver', 'core'] } } },
            },
            {
              from: { element: { type: 'cli-command' } },
              allow: { to: { file: { categories: 'cli-model' } } },
            },
            {
              from: { element: { type: 'cli-command' } },
              allow: {
                to: { element: { type: 'cli-command', captured: { name: '{{ from.element.captured.name }}' } } },
              },
            },
            {
              from: { element: { type: 'cli' } },
              allow: { to: { element: { type: ['cli', 'cli-command', 'compile', 'deliver', 'core'] } } },
            },
            // 4. Entry points: bin runs the CLI. index (the package entry) re-exports what workflow files
            // import from 'n8nlift' (defineWorkflow and the workflow types), all from compile.
            {
              from: { file: { categories: 'bin' } },
              allow: { to: { element: { type: 'cli' } } },
            },
            {
              from: { file: { categories: 'index' } },
              allow: { to: { element: { type: 'compile' } } },
            },
            // 5. Test runner: nobody, then tests.
            {
              disallow: { to: { module: { source: 'vitest' } } },
              message: 'Production source does not import vitest.',
            },
            {
              from: { file: { categories: 'test' } },
              allow: { to: { module: { source: 'vitest' } } },
            },
            // 6. Fakes (*.fake.ts) are test code: production source never imports one. Tests and fakes
            // reach them through the layer allows above, so a core/ test cannot use the CLI fake.
            {
              // Production source: a file in no category, or in neither the test nor the fake category.
              from: [{ file: { isUnknown: true } }, { file: { categories: { noneOf: ['test', 'fake'] } } }],
              disallow: { to: { file: { categories: 'fake' } } },
              message: 'Production source does not import the fakes (*.fake.ts): only tests do.',
            },
            {
              // Command tests build their context with fakeContext() from cli/cli.fake.ts (src/cli/AGENTS.md).
              from: { element: { type: 'cli-command' }, file: { categories: 'test' } },
              allow: { to: { element: { type: 'cli' }, file: { categories: 'fake' } } },
            },
            {
              // The allowlist already blocks this edge. This policy only names the rule in the error.
              from: { file: { path: 'src/core/**' } },
              disallow: { to: { file: { path: 'src/cli/**' } } },
              message: 'core/ never imports cli/, tests included (src/core/AGENTS.md).',
            },
          ],
        },
      ],
    },
  },
);
