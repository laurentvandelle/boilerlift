# Build once. Lift everywhere.

**Version, test and deploy your n8n workflows to every environment and client, from one Git repo.**

![A lift raising a block of generic workflow nodes](https://raw.githubusercontent.com/laurentvandelle/boilerlift/main/.github/assets/boilerlift-lift.gif)

[![npm version](https://img.shields.io/npm/v/boilerlift)](https://www.npmjs.com/package/boilerlift)
[![CI](https://github.com/laurentvandelle/boilerlift/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/laurentvandelle/boilerlift/actions/workflows/verify.yml?query=branch%3Amain)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/laurentvandelle/boilerlift/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen)](https://nodejs.org)
[![n8n](https://img.shields.io/badge/n8n-%3E%3D2.35.0-orange)](https://docs.n8n.io)

Build a workflow once, keep it in Git, and lift it to dev, staging, prod or every client's n8n instance with one command. Every change is checked before it leaves your machine, and lands as a draft: the published version keeps running until you publish.

> Status: pre-release (0.x). It works, but expect changes between versions.

## Get started

No fancy commands. Just a prompt.

```text
Read https://raw.githubusercontent.com/laurentvandelle/boilerlift/main/docs/get-started.md
and follow it to set up Boilerlift with me, one step at a time.
```

Paste it into your AI agent (Claude Code, Cursor, Codex…). It checks Node.js, creates your project, connects it to your n8n instance and deploys an example workflow as a draft, asking you one question at a time.

Developer, or no AI agent? See the [manual install](https://github.com/laurentvandelle/boilerlift/blob/main/docs/manual-install.md).

## Docs

- [Get started with an AI agent](https://github.com/laurentvandelle/boilerlift/blob/main/docs/get-started.md): the guide your agent follows
- [Manual install](https://github.com/laurentvandelle/boilerlift/blob/main/docs/manual-install.md): install and set up Boilerlift yourself
- [`lift init`](https://github.com/laurentvandelle/boilerlift/blob/main/docs/commands/init.md): start a project, with the Agent kit for AI agents
- [Write a workflow](https://github.com/laurentvandelle/boilerlift/blob/main/docs/workflows.md)
- [Configure your targets](https://github.com/laurentvandelle/boilerlift/blob/main/docs/configuration.md)
- [`lift ping`](https://github.com/laurentvandelle/boilerlift/blob/main/docs/commands/ping.md): check the connection to your instance
- [`lift status`](https://github.com/laurentvandelle/boilerlift/blob/main/docs/commands/status.md): see where each workflow stands on your instance, and the next step
- [`lift deploy`](https://github.com/laurentvandelle/boilerlift/blob/main/docs/commands/deploy.md): deliver your workflows, or preview with `--dry-run`
- [`lift publish`](https://github.com/laurentvandelle/boilerlift/blob/main/docs/commands/publish.md): publish your deployed drafts, after a confirmation
- [`lift clean`](https://github.com/laurentvandelle/boilerlift/blob/main/docs/commands/clean.md): archive the workflows you removed from the project, or delete them for good with `--delete`, after a confirmation
- [`lift reset`](https://github.com/laurentvandelle/boilerlift/blob/main/docs/commands/reset.md): remove every workflow Boilerlift deployed on one target, after you type its name
- [`lift creds sync`](https://github.com/laurentvandelle/boilerlift/blob/main/docs/commands/creds.md): write the credentials of your instance to your project, and see the ones your workflows miss

`lift help` lists every command and `lift help <command>` its options; `lift version` prints the installed version.

## Contributing

See [CONTRIBUTING.md](https://github.com/laurentvandelle/boilerlift/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/laurentvandelle/boilerlift/blob/main/LICENSE)

Boilerlift is an independent open source project. Not affiliated with n8n GmbH.
