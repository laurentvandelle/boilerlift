import { FileCreation } from '#src/cli/cli.model';

/** One file of the project `lift init` writes: its path in the project, and what happened to it. */
export type InitFile = { path: string } & FileCreation;
