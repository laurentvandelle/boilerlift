import { styleText } from 'node:util';
import { CliResult } from '#src/cli/cli.model';

/**
 * The one symbol vocabulary of every human output (`docs/output-style.md`). Each symbol has one meaning everywhere:
 * the workflow changes, then the checks (ping, init) and the warning.
 */
export const SYMBOLS = {
  /** Created, would create, missing on the instance. */
  created: '+',
  /** Recreated, would recreate. */
  recreated: '*',
  /** Updated, would update, differs from n8n. */
  updated: '~',
  /** Published, draft not yet published. */
  published: '^',
  /** Archived, deleted, removed from the project. */
  removed: '-',
  /** Restored, archived in n8n (the next deploy restores it). */
  restored: '↺',
  /** Unchanged: skipped, up to date, already published, already archived. */
  unchanged: '=',
  /** Not found. */
  notFound: '?',
  /** Not in my project (unmanaged). */
  unmanaged: '·',
  /** A check that passed, a file created. */
  ok: '✓',
  /** A check or a workflow that failed. */
  failed: '✗',
  /** Not run, skipped, not processed. */
  skipped: '–',
  /** A warning. */
  warning: '!',
} as const;

export type OutputSymbol = (typeof SYMBOLS)[keyof typeof SYMBOLS];

/** The widest the name column gets. A longer name pushes only its own state two spaces after it. */
export const NAME_WIDTH_MAX = 32;

/** Follow-up lines start at the name column: after the symbol and its space. */
const FOLLOW_UP_INDENT = '  ';

/** The first line of every command: `lift <command> · <target> (<url>)`, or without the url when `url` is undefined. */
export function header(command: string, target: string, url?: string): string {
  return url === undefined ? `${command} · ${target}` : `${command} · ${target} (${url})`;
}

/** One row of a list: `<symbol> <name> <state>`, then its follow-ups (cause, error detail, `→` next command). */
export interface Row {
  symbol: OutputSymbol;
  name: string;
  /** What happened to it, or where it stands. Empty: the row is the symbol and the name only. */
  state: string;
  /** The lines under the row, each at the name column. */
  followUps?: readonly string[];
}

/** The rows of a list, the names padded to the longest of them, capped at NAME_WIDTH_MAX. */
export function rows(list: readonly Row[]): string[] {
  const width = Math.min(NAME_WIDTH_MAX, Math.max(0, ...list.map(({ name }) => name.length)));
  return list.flatMap(({ symbol, name, state, followUps = [] }) => [
    state === '' ? `${symbol} ${name}` : `${symbol} ${name.padEnd(width)}  ${state}`,
    ...followUps.map((line) => `${FOLLOW_UP_INDENT}${line}`),
  ]);
}

/**
 * The lines of an error cause: `<call> : <detail>`, then each further line of a detail of several lines, with its own
 * indent kept (n8n nests the issues of each node). Blank lines are dropped.
 */
export function cause(call: string, detail: string): string[] {
  const [first = '', ...rest] = detail.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
  return [`${call} : ${first.trim()}`, ...rest];
}

/** A failure that stopped the command before its list: `✗ <call> : <detail>`, then its follow-ups at the name column. */
export function stopped(call: string, detail: string, followUps: readonly string[] = []): string[] {
  const [first = '', ...rest] = cause(call, detail);
  return [`${SYMBOLS.failed} ${first}`, ...[...rest, ...followUps].map((line) => `${FOLLOW_UP_INDENT}${line}`)];
}

/** A next step: `→ <command>`, or `→ <command>  <purpose>`. `→` means "next command" and nothing else. */
export function next(command: string, purpose?: string): string {
  return purpose === undefined ? `→ ${command}` : `→ ${command}  ${purpose}`;
}

/** A warning line. */
export function warning(text: string): string {
  return `${SYMBOLS.warning} ${text}`;
}

/**
 * The text of one stream: its sections in order (header, list, summary, next step), one blank line between two
 * non-empty ones, ending with a line break. An empty section adds nothing, and no section at all is `''`.
 */
export function sections(...parts: ReadonlyArray<readonly string[]>): string {
  const filled = parts.filter((part) => part.length > 0);
  return filled.length === 0 ? '' : `${filled.map((part) => part.join('\n')).join('\n\n')}\n`;
}

/**
 * Colours a finished result on its hotspots, when `color` is on: `✗` and its error lines in red, `!` in yellow, `✓`
 * and `+` in green, `→` next commands in cyan, `=` and `·` rows, the url and the workflow links dimmed. Colour only adds to the text:
 * every symbol, word and indent is there without it. A --json stdout is never coloured.
 */
export function paint(result: CliResult, view: { color: boolean; json: boolean }): CliResult {
  if (!view.color) {
    return result;
  }
  return { ...result, stdout: view.json ? result.stdout : paintText(result.stdout), stderr: paintText(result.stderr) };
}

/** `paint` on one text, for a question written before the result. */
export function paintText(text: string): string {
  let failedIndent: number | undefined;
  return text
    .split('\n')
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      const body = line.slice(indent);
      if (failedIndent !== undefined && indent > failedIndent && !body.startsWith('→ ')) {
        return `${line.slice(0, indent)}${color('red', body)}`;
      }
      failedIndent = body.startsWith(`${SYMBOLS.failed} `) ? indent : undefined;
      return `${line.slice(0, indent)}${paintLine(body)}`;
    })
    .join('\n');
}

type Tone = 'red' | 'yellow' | 'green' | 'cyan' | 'dim';

const SYMBOL_TONES: ReadonlyArray<[string, Tone]> = [
  [SYMBOLS.failed, 'red'],
  [SYMBOLS.warning, 'yellow'],
  [SYMBOLS.ok, 'green'],
  [SYMBOLS.created, 'green'],
];

const HEADER_URL = /^(lift .* · .*|── .*) \((\S+)\)$/;

/** A workflow link in a row (`workflowLink`, `core/n8n/n8n-api.ts`): `<target url>/workflow/<id>`. */
const WORKFLOW_LINK = /\bhttps?:\/\/\S+?\/workflow\/[\w-]+/g;

/** `text` with every workflow link dimmed, like the url of the header. */
function dimLinks(text: string): string {
  return text.replace(WORKFLOW_LINK, (link) => color('dim', link));
}

function paintLine(body: string): string {
  if (body.startsWith('→ ')) {
    const end = body.indexOf('  ');
    return end === -1 ? color('cyan', body) : `${color('cyan', body.slice(0, end))}${body.slice(end)}`;
  }
  if (body.startsWith(`${SYMBOLS.unchanged} `) || body.startsWith(`${SYMBOLS.unmanaged} `)) {
    return color('dim', body);
  }
  for (const [symbol, tone] of SYMBOL_TONES) {
    if (body.startsWith(`${symbol} `)) {
      return `${color(tone, symbol)}${dimLinks(body.slice(symbol.length))}`;
    }
  }
  const url = HEADER_URL.exec(body);
  if (url !== null) {
    return `${url[1] ?? ''} ${color('dim', `(${url[2] ?? ''})`)}`;
  }
  return dimLinks(body);
}

/** `text` in `tone`. The caller decided colour is on: the stream is not checked again. */
function color(tone: Tone, text: string): string {
  return styleText(tone, text, { validateStream: false });
}
