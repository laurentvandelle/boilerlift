import { WorkflowFile } from '#src/core/compile/workflow.model';
import { ExitCode } from '#src/core/common/exit-codes';
import { Result } from '#src/core/common/result';
import { CredentialsFile } from '#src/core/credentials/credentials.model';
import { BoilerliftConfig, ProjectConfig, ProjectConfigFile, Target, TargetSelection } from '#src/core/config/config.model';
import { N8nClient } from '#src/core/n8n/n8n.model';

export type { BoilerliftConfig, CredentialsFile, ProjectConfigFile, TargetSelection, WorkflowFile };

export interface CliResult {
  exitCode: ExitCode;
  stdout: string;
  stderr: string;
}

interface OptionBase {
  short?: string;
  /** What the help shows as the value of a string option, `--target <name>`. Defaults to the option name. */
  valueName?: string;
  description: string;
}

/**
 * One option of a command, by its role:
 * - a plain value, read through `input.options` (`flag`, `text`);
 * - `format: true`: it changes how the result prints, and reaches `render` in `format`;
 * - `mode: true`: a boolean that picks the code to run, the handler of the same name in `modes`.
 *
 * An option is never both a mode and a format.
 */
export type CommandOption =
  | (OptionBase & { type: 'boolean' | 'string'; format?: true; mode?: never })
  | (OptionBase & { type: 'boolean'; mode: true; format?: never });

/** What runCli hands to every command: the positionals, and the option values `parseArgs` read, by option name. */
export interface CommandInput {
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

/** The names of the options in `Options` whose type is `Type`. */
export type OptionNames<Options, Type extends CommandOption['type']> = {
  [Name in keyof Options]: Options[Name] extends { type: Type } ? Name : never;
}[keyof Options] &
  string;

/** The names of the mode options in `Options`: each one has its handler in `modes`. */
export type ModeNames<Options> = {
  [Name in keyof Options]: Options[Name] extends { mode: true } ? Name : never;
}[keyof Options] &
  string;

/** The values of the `format: true` options, by name: a boolean is true when given, a string is its value. */
export type FormatValues<Options> = {
  [Name in keyof Options as Options[Name] extends { format: true } ? Name : never]: Options[Name] extends {
    type: 'boolean';
  }
    ? boolean
    : string | undefined;
};

/** The option values of a command, read by name: a name that `Options` does not declare with that type is a type error. */
export interface OptionValues<Options> {
  /** A boolean option: true when it was given. */
  flag(name: OptionNames<Options, 'boolean'>): boolean;
  /** A string option: its value, or undefined when it was not given. */
  text(name: OptionNames<Options, 'string'>): string | undefined;
}

/** What `prepare`, the handlers and `render` read from the command line. */
export interface TypedCommandInput<Options> {
  positionals: string[];
  options: OptionValues<Options>;
  format: FormatValues<Options>;
  /** The mode option that was given, or `'default'`. */
  mode: ModeNames<Options> | 'default';
  /** The targets `--target` and `--all` select: `default` without them, and for a command that does not need targets. */
  target: TargetSelection;
}

/** A selected target, with the client of its n8n instance built on `ctx.fetch`. */
export interface ConnectedTarget extends Target {
  client: N8nClient;
}

/** The `'targets'` need: the project config, and the targets the command runs on, in the order it runs them. */
export interface SelectedTargets {
  config: ProjectConfig;
  selected: readonly ConnectedTarget[];
}

/**
 * Everything a command may declare in `needs`: a field of `CommandContext`, or `'targets'`, the targets of
 * `./boilerlift.config.ts` that `--target` and `--all` select, ready to connect to.
 */
export interface NeedSources extends CommandContext {
  targets: SelectedTargets;
}

export type NeedName = keyof NeedSources;

/** What a command receives: only the needs it declares. Reading another one is a type error. */
export type Deps<Needs extends NeedName> = Pick<NeedSources, Needs>;

/** The help of a command, beyond its summary. The usage line, the options and the targets section are generated. */
export interface CommandHelp {
  /** Written after the usage line, as in `lift help [command]`. */
  positionals?: string;
  /** What the command does, in prose. */
  description?: string;
  /** Every exit code the command returns, with what it means. */
  exitCodes: readonly (readonly [ExitCode, string])[];
}

/** The code that runs for one mode option, or by default: it does the work and returns what `render` prints. */
export type CommandHandler<Options, Needs extends NeedName, Prepared, Output> = (
  prepared: Prepared,
  deps: Deps<Needs>,
  input: TypedCommandInput<Options>,
) => Promise<Output>;

/**
 * What defineCommand takes. It reads top to bottom, in the order it runs:
 * `help` → `options` → `needs` → `prepare` → `modes` / `default` → `render`.
 */
export interface CommandSpec<
  Options extends Readonly<Record<string, CommandOption>>,
  Needs extends NeedName,
  Prepared,
  Output,
> {
  name: string;
  summary: string;
  help: CommandHelp;
  allowPositionals: boolean;
  /**
   * The options of this command. Every command also takes `-h, --help`, which dispatch handles, and a command that
   * needs `'targets'` takes `--target` and `--all`: never declare them.
   */
  options: Options;
  /**
   * The context this command uses. `'targets'` resolves the targets `--target` and `--all` select, or exits 1 with the
   * config error (as JSON too when a `json` format option is given).
   */
  needs: readonly Needs[];
  /** The work every mode shares. An `err` is a render that ends the command early: no handler runs. */
  prepare?: (input: TypedCommandInput<Options>, deps: Deps<Needs>) => Promise<Result<Prepared, CliResult>>;
  /** One handler per mode option, by its name: it runs instead of `default` when its flag is given. `{}` without one. */
  modes: { readonly [Name in ModeNames<Options>]: CommandHandler<Options, Needs, Prepared, Output> };
  /** Runs when no mode option is given. */
  default: CommandHandler<Options, Needs, Prepared, Output>;
  /** Turns what the handler returned into the CliResult. Lives in `<name>.render.ts`. */
  render: (output: Output, view: RenderView<Options, Needs, Prepared>) => CliResult;
}

/** What `render` sees besides the output: the command line, what `prepare` returned, and the needs. */
export interface RenderView<Options, Needs extends NeedName, Prepared> {
  format: FormatValues<Options>;
  mode: ModeNames<Options> | 'default';
  target: TargetSelection;
  prepared: Prepared;
  deps: Deps<Needs>;
}

export interface CommandContext {
  version: string;
  registry: readonly CommandDefinition[];
  /**
   * Imports `./boilerlift.config.ts` and returns its default export: `missing` when there is no file, `unreadable`
   * with the reason when it cannot be imported. The variables of `./.env` are in the environment first, so the file
   * can read them from `process.env`; a variable already set keeps its value.
   */
  loadProjectConfig(): Promise<ProjectConfigFile>;
  /** True when `path`, relative to the current folder, is an existing folder. */
  isDirectory(path: string): Promise<boolean>;
  nodeVersion: string;
  fetch: typeof fetch;
  /**
   * Reads every workflow file under `dir` (the paths `isWorkflowFilePath` accepts), recursively, skipping
   * `node_modules`, sorted by path. Paths are relative to the current folder. Resolves `[]` when `dir` does not
   * exist. A file that cannot be parsed or imported comes back with an `error` instead of `content`.
   */
  loadWorkflowFiles(dir: string): Promise<WorkflowFile[]>;
  /** Raw text of the lock file at `path`, relative to the current folder, or `undefined` when there is no file. */
  readLockFile(path: string): Promise<string | undefined>;
  /**
   * Writes `text` as the whole lock file at `path`, relative to the current folder. A disk error comes back as a
   * failure with its `reason`, never a throw.
   */
  writeLockFile(path: string, text: string): Promise<Result<void, { reason: string }>>;
  /**
   * Imports every `.ts` file of `dir` (not its subfolders), relative to the current folder, sorted by path, and returns
   * its default export. Resolves `[]` when `dir` does not exist. A file that cannot be imported comes back with an
   * `error` instead of `content`. Call it before `loadWorkflowFiles`: the lists it imports give `credential()` its types.
   */
  loadCredentialsFiles(dir: string): Promise<CredentialsFile[]>;
  /**
   * Writes `text` as the whole file at `path`, relative to the current folder, creating its folder when needed. A disk
   * error comes back as a failure with its `reason`, never a throw.
   */
  writeCredentialsFile(path: string, text: string): Promise<Result<void, { reason: string }>>;
  /**
   * Writes `prompt` to stderr, as is, then reads one line of stdin, TTY or not, so a person and an agent answer the
   * same way. Resolves the line without its line break, or `undefined` when stdin closes first (EOF).
   */
  ask(prompt: string): Promise<string | undefined>;
  /**
   * True when stdin is a terminal, so a person can answer a question. A command that must not ask a script or an agent
   * (clean, before it archives) checks it before `ask`.
   */
  isInteractive: boolean;
}

/** A command as the registry and runCli see it, its types erased. Build one with defineCommand. */
export interface CommandDefinition {
  name: string;
  summary: string;
  help: CommandHelp;
  allowPositionals: boolean;
  /** True when the command needs `'targets'`: it then takes `--target` and `--all`. */
  targets: boolean;
  options: Readonly<Record<string, CommandOption>>;
  /** The names of the mode options: dispatch rejects more than one at a time. */
  modes: readonly string[];
  run(input: CommandInput, ctx: CommandContext): Promise<CliResult>;
}
