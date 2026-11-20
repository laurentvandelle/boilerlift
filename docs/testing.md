# Writing tests

Tests pin what the code does, so the code can change without fear. A test that breaks on every refactor, or passes when the code is wrong, costs more than it saves. These rules keep tests short, alike, and about behaviour.

## Shape

```ts
test('Should report the workflow created with its new id when the lock file does not record it', async () => {
  const n8n = fakeN8n();

  const report = await deploy({ workflows: [fakeLocalWorkflow('invoice-sync')], client: n8n.client, managed: fakeManaged() }, fakeLockWriter().writer);

  expect(report.results).toEqual([expect.objectContaining({ stableName: 'invoice-sync', action: 'created', id: 'w1' })]);
});
```

A full suite in this shape: `src/core/deliver/deploy.test.ts`.

- **The title reads `Should {outcome} when {condition}`.** The list of tests then reads as a specification.
- **The body is three blocks: given, when, then.** One blank line separates them, and no comment labels them. The blank lines carry the structure, so every test reads the same at a glance.
- **One test, one behaviour.** A second behaviour gets its own test, with its own fake instance, so a failure names exactly what broke. A test that runs the command twice, once for text and once for `--json`, is two tests.
- **Test through the public interface.** The test calls the module through the same interface its callers use. Do not export a helper only so a test can call it: pin its cases through the function that uses it. A test that reaches into internals breaks on every refactor and proves nothing about callers.
- **Import `describe`, `expect` and `test` from `vitest`** explicitly.

## Where tests live

- Tests sit next to the code as `*.test.ts`. Vitest only picks up `src/**/*.test.ts`.
- Type tests sit next to the code as `*.test-d.ts`. Vitest checks them with `tsc`, so `npm test` fails when a type rule breaks. Example: `src/core/compile/define-workflow.test-d.ts`.
- Fakes and builders live in `*.fake.ts` files next to the code they stand in for. They are test code: production source never imports them, and the build leaves them out.

## Dependencies

Use the real thing wherever the test can, and pick the stand-in by the kind of dependency:

| Dependency | In tests |
| --- | --- |
| In-process code (pure logic, in-memory state) | The real code |
| The n8n instance | The shared in-memory instance, `fakeN8n()` in `src/core/n8n/n8n.fake.ts` |
| The outside world of a command (project config, Node.js version, workflow files, lock file) | A `CommandContext` from `fakeContext()` in `src/cli/cli.fake.ts`, with `fakeProjectConfig()` or `fakeSingleTarget()` for `boilerlift.config.ts` and `fakeLockFile()` for the lock file |

`fakeN8n()` is one store with two doors: `.client`, the `N8nClient` port, for core tests, and `.fetch`, answering like the n8n public API, for command tests. `src/services/` tests pass their own `fetch` stub: they test the HTTP adapter itself. `src/cli/AGENTS.md` and `src/core/AGENTS.md` say which door each test uses. Do not write another n8n stand-in: two of them drift apart.

Do not `vi.mock` the repository's own modules: mocking your own code tests the mock, not the code.

## Data

- **Use the shared builders.** Build test data with the `fake*` builders, which hold sensible defaults and take overrides, so each test states only the values it is about: `fakeNode`, `fakeLocalWorkflow`, `fakeWorkflowFile` and `fakeStableName` in `src/core/compile/workflow.fake.ts`; `fakeCredentialSlot` and `fakeWorkflowFileUsing` in `src/core/compile/credential.fake.ts`; `fakeCredentialsWriter` in `src/core/credentials/credentials.fake.ts`; `fakeN8nWorkflow`, `fakeCredential`, `fakeWorkflowId`, `fakeTagId`, `httpError`, `unreachable` and `invalidResponse` in `src/core/n8n/n8n.fake.ts`, with `fakeN8nByOrigin` to route one `fetch` to an instance per target; `fakeManaged`, `fakeLockText` and `fakeLockWriter` in `src/core/deliver/lock-file.fake.ts`; `fakeLockFile`, `fakeAnswer` (stdin for a question), `fakeCredentialsFolder`, `fakeProjectConfig`, `fakeSingleTarget` and `fakeTwoTargets` in `src/cli/cli.fake.ts`. Add a missing builder there, next to its model, instead of in a test file.
- **Branded values go through their guards.** `fakeStableName`, `fakeWorkflowId` and `fakeTagId` call the same guards as the code, so a test cannot build a value the code would reject.
- **Keep tests short and alike.** Use the same shape, the same builders and the same stand-ins across the suite. The `as const` literals of the type tests stay: the type checks need them.

## From story to test

Each acceptance criterion of a story becomes one test, named after the criterion. The criteria are then checked on every run, not once at review.

## Red, green, refactor

For new behaviour:

1. **Red.** Write the test and run it. It must fail, and for the reason the criterion states.
2. **Green.** Write the code that makes it pass.
3. **Refactor.** Clean up while the test stays green.

A test that pins existing behaviour before a refactor passes from the start. Break the code or the expectation once on purpose, watch the test fail, then restore it. A test that has never failed may be testing nothing.

## Enforced by verify

The test lint in `eslint.config.mts` makes these errors, so `npm run verify` rejects them: focused, skipped and placeholder (`todo`) tests, two tests with the same title, a test without an assertion, sleeps, `vi.mock` of the repository's own modules, comments that label the three blocks, and titles in another shape. Production source that imports a fake fails lint too.

No check enforces one behaviour per test, testing through the public interface, the shared builders, or the shared n8n fake. Review does.
