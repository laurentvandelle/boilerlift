import { TemplateFetchError } from '#src/cli/cli.model';

/** The folder `lift init` writes into, missing or empty: its path as given, and whether it already holds `.git`. */
export interface InitFolder {
  path: string;
  hasGit: boolean;
}

/** One file of the project `lift init` writes: its path in the project, and whether it was written. */
export type InitFile = { path: string; status: 'created' } | { path: string; status: 'failed'; reason: string };

/** What `lift init` did: the files it wrote, or the Project template it could not fetch, before writing anything. */
export type InitOutput = { kind: 'written'; files: InitFile[] } | { kind: 'template-unavailable'; error: TemplateFetchError };
