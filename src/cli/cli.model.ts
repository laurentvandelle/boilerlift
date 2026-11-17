import { WorkflowFile } from '#src/core/compile/workflow.model';
import { ExitCode } from '#src/core/exit/exit-codes';

export type { WorkflowFile };

export interface CliResult {
  exitCode: ExitCode;
  stdout: string;
  stderr: string;
}

export interface CommandOption {
  type: 'boolean' | 'string';
  short?: string;
  description: string;
}

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

/** The option values of a command, read by name: a name that `Options` does not declare with that type is a type error. */
export interface OptionValues<Options> {
  /** A boolean option: true when it was given. */
  flag(name: OptionNames<Options, 'boolean'>): boolean;
  /** A string option: its value, or undefined when it was not given. */
  text(name: OptionNames<Options, 'string'>): string | undefined;
}

/** What a command built with defineCommand receives: option values typed by its declared options. */
export interface TypedCommandInput<Options> {
  positionals: string[];
  options: OptionValues<Options>;
}

/** What defineCommand takes: a command whose `run` reads options typed by its `options`. */
export interface CommandSpec<Options extends Readonly<Record<string, CommandOption>>> {
  name: string;
  summary: string;
  usage: string;
  allowPositionals: boolean;
  options: Options;
  run(input: TypedCommandInput<Options>, ctx: CommandContext): Promise<CliResult>;
}

export interface CommandContext {
  version: string;
  registry: readonly CommandDefinition[];
  env: Readonly<Record<string, string | undefined>>;
  /** Raw text of `./.env`, or `undefined` when there is no file. */
  dotEnv: string | undefined;
  nodeVersion: string;
  fetch: typeof fetch;
  /**
   * Reads every workflow file under `dir` (the paths `isWorkflowFilePath` accepts), recursively, skipping
   * `node_modules`, sorted by path. Paths are relative to the current folder. Resolves `[]` when `dir` does not
   * exist. A file that cannot be parsed or imported comes back with an `error` instead of `content`.
   */
  loadWorkflowFiles(dir: string): Promise<WorkflowFile[]>;
}

/** A command as the registry and runCli see it, its option types erased. Build one with defineCommand. */
export interface CommandDefinition {
  name: string;
  summary: string;
  usage: string;
  allowPositionals: boolean;
  options: Readonly<Record<string, CommandOption>>;
  run(input: CommandInput, ctx: CommandContext): Promise<CliResult>;
}
