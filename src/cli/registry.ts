import { CommandDefinition } from '#src/cli/cli.model';
import { cleanCommand } from '#src/cli/commands/clean/clean.command';
import { credsSyncCommand } from '#src/cli/commands/creds-sync/creds-sync.command';
import { deployCommand } from '#src/cli/commands/deploy/deploy.command';
import { helpCommand } from '#src/cli/commands/help/help.command';
import { publishCommand } from '#src/cli/commands/publish/publish.command';
import { pingCommand } from '#src/cli/commands/ping/ping.command';
import { statusCommand } from '#src/cli/commands/status/status.command';
import { versionCommand } from '#src/cli/commands/version/version.command';

export const COMMANDS: readonly CommandDefinition[] = [
  helpCommand,
  versionCommand,
  pingCommand,
  statusCommand,
  deployCommand,
  publishCommand,
  cleanCommand,
  credsSyncCommand,
];
