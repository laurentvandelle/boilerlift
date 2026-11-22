# Output style

Every human-readable output of `lift` follows one style, so a person reads any command at a glance. `src/cli/output.render.ts` holds it: each `<name>.render.ts` builds its text with these helpers, never with its own marks, columns or indents. The `--json` output does not follow this page: it is a contract for scripts, and it does not change with the style.

The help (`help.render.ts`) and the version output are not part of the style.

## Sections

An output is up to four sections, in this order:

1. **Header**: `lift <command> · <target> (<url>)`. Ping leaves out the url: its own lines show it.
2. **List**: one row per workflow (or check, file, credential), then any warning.
3. **Summary**: the counts, and the lines about the whole run.
4. **Next step**: the commands to run next, `→ <command>  <purpose>`.

One blank line goes between two non-empty sections. An empty section adds nothing. `sections()` applies the rule; it applies to stdout and stderr separately, and a line never changes stream for the style: recaps and errors stay on stderr.

A list may hold several groups, each with its own heading (`Removed from the project:`, `Not deployed yet:`). Each group is a section of its own.

## Rows

```text
<symbol> <name>  <state>
  <follow-up>
```

- `rows()` pads the names to the longest of the list, capped at 32 characters (`NAME_WIDTH_MAX`). A longer name pushes only its own state, two spaces after it; the other rows keep the column.
- The state is what happened, or where the workflow stands, then its detail: `created  workflows/crm-import.ts`.
- Follow-ups start at the name column, two spaces in: the cause of a failure, every further line of a detail of several lines (with its own indent kept), then the `→` next command. Their place does not depend on the length of the name.
- A failure that stopped the command before its list is `stopped()`: `✗ <call> : <detail>`, its follow-ups under it.

An error cause is `<call> : <detail>`, as in `PUT /api/v1/workflows/crm1 : HTTP 500 boom` (`cause()`).

`→` means "next command" and nothing else: `→ lift deploy`, or `→ lift publish  publishes the drafts` with its purpose. A step that is prose, like the hint of an error, also takes `→`. The header and the causes never use it.

## Symbols

Each symbol has one meaning in every command (`SYMBOLS`):

| Symbol | Meaning |
| --- | --- |
| `+` | created, would create, missing on the instance |
| `*` | recreated, would recreate |
| `~` | updated, would update, differs from n8n |
| `^` | published, draft not yet published |
| `-` | archived, deleted, removed from the project |
| `↺` | restored, archived in n8n (the next deploy restores it) |
| `=` | unchanged: skipped, up to date, already published, already archived |
| `?` | not found |
| `·` | not in my project (unmanaged) |
| `✓` | a check that passed, a file created |
| `✗` | failed: a check, a file, every failed workflow |
| `–` | not run, skipped, not processed |
| `!` | a warning |

## Colour

Colour marks the hotspots only: `✗` and its error lines in red, `!` in yellow, `✓` and `+` in green, `→` next commands in cyan, the `=` and `·` rows, the url and the workflow links in grey (bright black, not dim: some terminals stop opening a dimmed link on Ctrl+click). Names and states keep the default colour.

Colour is never the only carrier of meaning: with colour off, every symbol, word and indent is still there. `paint()` adds it to a finished result, from the text alone, so a render function never colours anything itself.

`CommandContext.color` turns it on, and `defineCommand` paints every result and every question with it. `nodeContext` sets it when stdout and stderr are terminals. `NO_COLOR` turns it off and `FORCE_COLOR` turns it on (`FORCE_COLOR=0` off); `FORCE_COLOR` wins. A `--json` stdout is never coloured. `fakeContext()` has colour off, so tests pin plain strings.

## Example

```text
lift deploy · dev (https://n8n.example.com)

+ crm-import    created  workflows/crm-import.json
~ daily-report  updated  workflows/daily-report.json (draft; published version still running)
↺ weekly-sync   restored  workflows/weekly-sync.json (unpublished draft)
✗ invoices      failed
  PUT /api/v1/workflows/inv1 : HTTP 500: boom
  → Check the workflow in the n8n editor, then run deploy again
! weekly-sync: workflow ws1 was archived in n8n; it is back as an unpublished draft

1 created, 1 updated, 1 restored, 0 skipped, 1 failed.
Tag boilerlift:dev added to 3 workflows

→ lift publish  publishes the drafts
→ commit boilerlift.lock.json  it was updated
```

## Tests

Human-output tests run with colour off and pin exact strings. Colour is tested on its own: `src/cli/output.render.test.ts` for the rules, a command test with `color: true` for the wiring, and `src/cli/node-context.test.ts` for the terminal, `NO_COLOR` and `FORCE_COLOR`.
