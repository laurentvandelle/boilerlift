
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

/** The core/ folders: cli/ and the commands may import any of them (src/AGENTS.md). */
const CORE = ['compile', 'deliver', 'config', 'n8n', 'connection', 'exit', 'guard'];

const testTitle = ['^Should .+ when .+', 'Titles read "Should {outcome} when {condition}" (src/AGENTS.md).'];
const noSleep = 'No sleeps in tests: use fake timers or await the event.';

/** One way per job: `typeof x === 'object'` is written once, in isRecord. */
const inlineRecordCheck = {
  selector: "BinaryExpression:matches([left.operator='typeof'][right.value='object'], [right.operator='typeof'][left.value='object'])",
  message: 'Use isRecord from #src/core/guard/is-record: the object check is written once, there.',
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
    // Test lint and the hidden-dependency bans set no-restricted-syntax on their own files further down, and the
    // later block wins, so both repeat inlineRecordCheck. This block covers the rest of src/.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', inlineRecordCheck],
    },
  },
  {
    // Test lint. *.test-d.ts files hold type tests, which Vitest checks with tsc (vitest.config.mts).
    files: ['src/**/*.test.ts', 'src/**/*.test-d.ts'],
    ...vitest.configs.recommended,
    // Lets expect-expect count assertType and expectTypeOf as assertions.
    settings: { vitest: { typecheck: true } },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'assert'] }],
      'vitest/valid-title': ['error', { mustMatch: { it: testTitle, test: testTitle } }],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Promise'] CallExpression[callee.name='setTimeout']", message: noSleep },
        { selector: 'AwaitExpression > CallExpression[callee.name=/^(setTimeout|sleep|delay|wait)$/]', message: noSleep },
        {
          selector: "MemberExpression[object.name=/^(it|test|describe)$/][property.name='todo']",
          message: 'No placeholder tests: write the test or leave it out.',
        },
        {
          selector:
            "CallExpression[callee.object.name=/^(vi|jest)$/][callee.property.name=/^(mock|doMock)$/][arguments.0.value=/^(\\.|@\\/|#|~)/]",
          message: 'Mock only third-party services: use the real code, a fake (*.fake.ts) or an in-memory adapter.',
        },
        inlineRecordCheck,
      ],
      // Blank lines separate given, when and then; no comment labels them.
      'no-warning-comments': ['error', { terms: ['given', 'when', 'then', 'arrange', 'act', 'assert'], location: 'start' }],
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
      // One element per folder with rules of its own. A file in no element and no file category fails
      // boundaries/no-unknown-files, so a new folder under src/ needs its element here and its allow below.
      'boundaries/elements': [
        { type: 'cli-command', pattern: 'src/cli/commands/*', capture: ['name'] },
        { type: 'cli', pattern: 'src/cli' },
        { type: 'compile', pattern: 'src/core/compile' },
        { type: 'deliver', pattern: 'src/core/deliver' },
        { type: 'config', pattern: 'src/core/config' },
        { type: 'n8n', pattern: 'src/core/n8n' },
        { type: 'connection', pattern: 'src/core/connection' },
        { type: 'exit', pattern: 'src/core/exit' },
        { type: 'guard', pattern: 'src/core/guard' },
      ],
      'boundaries/files': [
        { category: 'test', pattern: '**/*.{test,test-d}.ts' },
        { category: 'cli-model', pattern: 'src/cli/*.model.ts' },
        { category: 'fake', pattern: 'src/**/*.fake.ts' },
        { category: 'n8n-client', pattern: 'src/core/n8n/n8n-client.ts' },
        { category: 'bin', pattern: 'src/bin.ts' },
        { category: 'index', pattern: 'src/index.ts' },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkAllOrigins: true,
          checkUnknownLocals: true,
          // Also check imports inside one element, so the fake and n8n-client fences below hold there too.
          checkInternals: true,
          policies: [
            // 1. npm packages and Node core: allowed unless a later policy says otherwise.
            { allow: { to: { module: { origin: ['external', 'core'] } } } },
            // 2. core/exit/ holds the exit codes of every command: every folder may import it. core/guard/ holds the
            // shared type guards (isRecord): every core/ folder may import it, and cli/ through CORE.
            { allow: { to: { element: { type: 'exit' } } } },
            {
              from: { element: { type: CORE } },
              allow: { to: { element: { type: 'guard' } } },
            },
            // 3. One allow per layer: itself plus the layers it may use (src/core/AGENTS.md).
            // compile/ reads and validates workflow files, with no network. deliver/ sends them to n8n and may
            // read what compile/ produces. config/ and n8n/ are shared folders that know neither stage; n8n/ builds
            // its client from the ConnectionConfig of config/. connection/ holds the checks behind ping.
            {
              from: { element: { type: 'compile' } },
              allow: { to: { element: { type: ['compile', 'config'] } } },
            },
            {
              from: { element: { type: 'deliver' } },
              allow: { to: { element: { type: ['deliver', 'compile', 'config', 'n8n'] } } },
            },
            {
              from: { element: { type: 'config' } },
              allow: { to: { element: { type: 'config' } } },
            },
            {
              from: { element: { type: 'n8n' } },
              allow: { to: { element: { type: ['n8n', 'config'] } } },
            },
            {
              from: { element: { type: 'connection' } },
              allow: { to: { element: { type: ['connection', 'config', 'n8n'] } } },
            },
            {
              // A command sees only itself, the CLI contracts (cli/*.model.ts) and core. Never another command.
              from: { element: { type: 'cli-command' } },
              allow: { to: { element: { type: CORE } } },
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
              allow: { to: { element: { type: ['cli', 'cli-command', ...CORE] } } },
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
            // 5. The allowlist already blocks these edges. These policies only name the rule in the error.
            {
              from: { element: { type: 'compile' } },
              disallow: { to: { element: { type: ['deliver', 'n8n', 'connection'] } } },
              message: 'compile/ imports only compile/, config/, exit/ and guard/: it never imports deliver/ and makes no network call (src/core/AGENTS.md).',
            },
            {
              from: { element: { type: ['config', 'n8n', 'exit', 'guard'] } },
              disallow: { to: { element: { type: ['compile', 'deliver'] } } },
              message: 'A shared core/ folder imports neither compile/ nor deliver/ (src/core/AGENTS.md).',
            },
            {
              from: { element: { type: 'deliver' } },
              disallow: { to: { element: { type: 'connection' } } },
              message: 'deliver/ does not import connection/, the checks behind ping: exit codes come from core/exit/.',
            },
            // 6. n8n-client.ts is the fetch adapter. Only n8n/ and the commands, which build the client from
            // ctx.fetch, import it. Every other folder uses the N8nClient port.
            {
              disallow: { to: { file: { categories: 'n8n-client' } } },
              message: 'Import the N8nClient port from #src/core/n8n/n8n.model: only n8n/ and the commands import n8n-client.ts.',
            },
            {
              from: { element: { type: ['n8n', 'cli-command'] } },
              allow: { to: { file: { categories: 'n8n-client' } } },
            },
            // 7. Test runner: nobody, then tests.
            {
              disallow: { to: { module: { source: 'vitest' } } },
              message: 'Production source does not import vitest.',
            },
            {
              from: { file: { categories: 'test' } },
              allow: { to: { module: { source: 'vitest' } } },
            },
            // 8. Fakes (*.fake.ts) are test code: production source never imports one. Tests and fakes
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
  {
    // Hidden-dependency bans. core/ and the commands take configuration, I/O, time and randomness through their
    // parameters (CommandContext, the N8nClient port), so a test controls them (src/cli/AGENTS.md). Tests keep
    // the Test lint no-restricted-syntax, which this block would replace, and fakes are test code too.
    files: ['src/core/**/*.ts', 'src/cli/commands/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/*.test-d.ts', 'src/**/*.fake.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          globals: [
            { name: 'process', message: 'Read configuration and versions from CommandContext or a parameter.' },
            { name: 'fetch', message: 'Reach n8n through the N8nClient port: a command builds it from ctx.fetch.' },
            { name: 'console', message: 'Return the output in the CliResult: bin.ts writes it.' },
          ],
          // Also reports globalThis.process, global.fetch and the like.
          checkGlobalObject: true,
          globalObjects: ['global'],
        },
      ],
      // Replaces the block above for these files, so it repeats the relative-import patterns.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...noBarrelOrRelative.patterns,
            {
              regex: '^(node:)?(fs|http|https|http2|net|tls|dgram|dns|child_process|process|console)(/.*)?$',
              message: 'No file, network or process access here: it comes through CommandContext or a port.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Inject a Clock.' },
        { object: 'Math', property: 'random', message: 'Inject a random source or an IdGenerator.' },
        { object: 'crypto', property: 'randomUUID', message: 'Inject an IdGenerator.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Inject a Clock.' },
        {
          selector: "MemberExpression[object.property.name='crypto'][property.name='randomUUID']",
          message: 'Inject an IdGenerator.',
        },
        {
          selector: "ImportDeclaration[source.value=/^(node:)?crypto$/] ImportSpecifier[imported.name='randomUUID']",
          message: 'Inject an IdGenerator.',
        },
        inlineRecordCheck,
      ],
    },
  },
);
