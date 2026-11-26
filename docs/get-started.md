# Get started with Boilerlift

This is the Get-started guide. **It is written for you, the AI agent.** A person pasted a prompt that asked you to read it and follow it. Take them from nothing installed to the example workflow deployed as a draft on their n8n instance.

The person may have no technical background. Speak plainly, explain each step in one or two sentences before you do it, and run the commands yourself when you can.

## Rules

- **Ask one question at a time.** Wait for the answer before you go on.
- **Never ask for the n8n API key in the chat.** The person types it into `.env` themselves, in their own editor.
- **Never read `.env`**, and never print, `cat`, `grep` or otherwise show its content. Check the connection with `npx lift ping --json` instead: it never prints the key.
- **Warn the person not to paste the key in the chat.** If they paste it anyway, do not repeat it, do not write it anywhere, and tell them to regenerate it in n8n.
- **Never write a secret to a file shared through Git.** The key goes in `.env` only. `lift init` writes a `.gitignore` that keeps `.env` out of Git.
- **Publish nothing.** This session stops at a draft on the `dev` target. Do not run `lift publish`, and do not deploy to any target other than `dev`.
- These rules hold from the first step: the guardrails of the Agent kit exist only once `lift init` has run.

## Before you start: find where to resume

The person may have started before. Run these checks in order, and stop at the first one that fails:

| Step | Done when |
| --- | --- |
| 1. Node.js | `node -v` prints `v22.18.0` or later |
| 2. Git | `git --version` prints a version |
| 3. Project folder | the project folder holds `boilerlift.config.ts` (ask for the folder name if you do not know it) and `node_modules/` |
| 4. Connection | `.env` exists in the project folder (check with `test -f .env`, never by reading it), and `npx lift ping --json` exits 0 |
| 5. Example deployed | `npx lift status -t dev --json` gives `hello` a state other than `missing` |

Tell the person where they resume, in one sentence, for example "Node.js and your project are ready: we resume at the connection to n8n." Then go on from that step. When every check passes, go to step 6.

## Step 1: Node.js

Run `node -v`.

- It prints `v22.18.0` or later: go on.
- The command is not found, or the version is older: explain that Boilerlift needs Node.js 22.18 or later. Ask them to download the LTS installer from [nodejs.org](https://nodejs.org), run it, then tell you when it is done. They may need to open a new terminal, or restart you, so the new version is found. Then run `node -v` again.

## Step 2: Git

Run `git --version`.

- It prints a version: go on.
- The command is not found: explain that `lift init` uses Git to download the project files, and that the skills of the project use it too. Walk them through installing it, for their system:
  - **macOS**: run `xcode-select --install` and accept the dialog that opens: it installs the Xcode Command Line Tools, which include Git.
  - **Windows**: ask them to download the installer from [git-scm.com](https://git-scm.com/downloads), run it with the default options, then tell you when it is done.
  - **Linux**: install it with the package manager, for example `sudo apt install git` on Debian or Ubuntu, or `sudo dnf install git` on Fedora. Ask before you run a command with `sudo`: it may ask for their password, which they type themselves.

  They may need to open a new terminal, or restart you, so Git is found. Then run `git --version` again.

## Step 3: the project folder

Ask what to call the folder that will hold their workflows, and suggest `my-n8n-workflows`. It must be a new folder, or an empty one.

Then, in the folder where the person wants it (their current folder, unless they say otherwise), run:

```sh
npx boilerlift@latest init <name>
cd <name>
git init
npm install
```

Use `boilerlift@latest`, not `boilerlift`, so an old copy in the npx cache cannot run. `init` downloads the project files and the Agent kit, writes them into the folder, and prints the next steps. If it exits 13, it could not download them: read its message, fix the cause (Git missing, no network) and run it again. Work inside that folder from now on: every later command runs there.

## Step 4: connect to n8n

First ask whether they already have an n8n instance, and its address.

**No n8n instance yet.** Recommend an [n8n Cloud](https://n8n.io/pricing/) trial first: it is the quickest start. For people who prefer to run n8n themselves, point to [n8n's self-hosting docs](https://docs.n8n.io/hosting/). Say that Boilerlift needs n8n 2.35.0 or later. Wait until they have an instance, then go on.

**Fill in `.env`.**

1. Copy the example file yourself: `cp .env.example .env`.
2. Explain where to find the API key: in n8n, **Settings → n8n API**, then create an API key and copy it.
3. Ask the person to open `.env` in their editor and fill in both lines themselves, then save:

   ```sh
   N8N_URL=https://their-n8n-address
   N8N_API_KEY=the-key-they-copied
   ```

   `N8N_URL` is the root address of the instance, the one they open in their browser, without `/home` or `/workflow` at the end.
4. Say it plainly: **do not paste the key in this chat.** It stays in `.env`, on their computer.
5. Ask them to tell you when the file is saved.

**Check the connection.** Run `npx lift ping --json`.

- Exit 0: the connection works. Go on.
- It fails: read the failed check and its next step in the JSON, then explain it:
  - the instance does not answer: the `N8N_URL` is probably wrong. Ask them to copy the address from their browser into `.env` again;
  - the key is refused: the key is wrong, incomplete or was deleted. Ask them to create a new one in n8n under **Settings → n8n API** and replace the line in `.env`. Warn again not to paste it in the chat.

  Then run `npx lift ping --json` again, until it passes.

## Step 5: deploy the example

Explain that the project already holds an example workflow, `workflows/hello.workflow.ts`, and that it will land as a draft: nothing is published.

Run:

```sh
npx lift deploy -t dev
```

It creates the workflow `hello`, shown as **Hello from Boilerlift** in n8n. If it fails, read the message and its next step, explain it, fix the cause with the person, and run it again.

Then tell the person how to see it run:

1. Open their n8n in the browser, and go to the workflow list (**Overview**, or **Workflows**).
2. Open **Hello from Boilerlift**.
3. Click **Execute workflow** at the bottom of the canvas.
4. Click the **Say hello** node to see its output.

Ask whether they can see it. If not, help them find it before you go on.

## Step 6: their own workflow

Congratulate them: Boilerlift is set up. Then explain how to create their own workflow, from this project folder:

- **In Claude Code**: type `/BOILERLIFT:ship <what the workflow should do>`, for example `/BOILERLIFT:ship every Monday, send me a summary of new rows in my Google Sheet`.
- **With another AI agent**: ask it to follow `.claude/skills/BOILERLIFT:ship/SKILL.md` for that workflow.

It asks them about the workflow, builds it, checks it, deploys it as a draft on `dev` and gives them the tests to run in n8n.

Do not start a workflow in this session. Stop here.
