#!/usr/bin/env python3
"""Exercise create_pr.py against a local bare remote and a fake gh.

Also checks the env linker and the dangerous-command hook in .claude/hooks/.
Run by hand from the repository root: python3 .claude/skills/boilerlift:ship/scripts/test_create_pr.py   (prints "ok", exits 1 on the first failure)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
MAIN = SCRIPTS / "create_pr.py"
LINKER = SCRIPTS / "link_env_files.py"
HOOK = ROOT.parent.parent / "hooks" / "block-dangerous.py"
PY_FILES = [MAIN, LINKER, HOOK, Path(__file__)]


def fail(msg: str):
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def check(cond, msg: str):
    if not cond:
        fail(msg)


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], capture_output=True, text=True, check=False, **kw)


def git(*args):
    out = run(["git", *args])
    check(out.returncode == 0, f"git {' '.join(map(str, args))}: {out.stderr.strip()}")
    return out.stdout.strip()


def static_checks():
    for path in PY_FILES:
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except SyntaxError as exc:
            fail(f"{path.name} does not compile: {exc}")
        check(os.access(path, os.X_OK), f"{path.name} is not executable")
    check(not list(SCRIPTS.glob("*.sh")), "a bash script is left in scripts/")
    text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    match = re.search(r'^description: "(.*)"$', text, re.M)
    check(match, "description is missing or not a single quoted line")
    check(len(match.group(1)) <= 1024, f"description is {len(match.group(1))} chars")
    check("auto-mode" in match.group(1), "description should say the coding session starts in auto mode")
    check("permission_mode` | `auto`" in text, "Launch table should pass permission_mode auto")
    check("npm run debug:setup" in text, "SKILL.md should run npm run debug:setup in the worktree")
    check("Test: cd <worktree> && npm start -- <cmd>" in text, "SKILL.md should keep the Test: reply line")
    forbidden = re.compile(r'"--no-verify"|"remove"|rmtree|os\.remove\(|unlink\(.*wt')
    for path in (MAIN, LINKER):
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            check(not forbidden.search(line), f"{path.name}:{n} contains a forbidden operation")


def hook_checks():
    def hook(expect: str, command: str):
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
        out = run([sys.executable, HOOK], input=payload)
        if expect == "allow":
            check(out.returncode == 0, f"hook exit {out.returncode}, want allow: {command}")
            check(not out.stdout, f"hook printed output for an allowed command: {command}")
        else:
            check(out.returncode == 2, f"hook exit {out.returncode}, want deny: {command}")
            data = json.loads(out.stdout)
            check(data["hookSpecificOutput"]["permissionDecision"] == "deny", f"not a deny: {command}")

    for cmd in (
        "git push -u origin HEAD",
        "git status --short && git diff --stat HEAD && git log --oneline -8",
        'git add a b && git commit -m "feat(x): y" && git log --oneline -2',
        'git commit -m "feat(env): link nested env files"',
        "git add src/app.ts", "rm file.txt", "rm -f file.txt", "npm test",
        "pnpm install --frozen-lockfile", "echo 'rm -rf /'", "echo 'git push --force'",
        "node -p \"require('./package.json').scripts?.verify ?? ''\"",
        "git clean -n", "git push --dry-run origin HEAD",
    ):
        hook("allow", cmd)
    for cmd in (
        "git push --force origin main", "git push origin main --force", "git push --force-with-lease",
        "git push -f origin", "git push -uf origin HEAD", "git -C /tmp/repo push --force",
        "git --force push origin main", "git push origin +HEAD:refs/heads/main",
        "git push --delete origin feature/x", "git push -d origin feature/x",
        "rm -rf /tmp/foo", "rm -fr foo", "rm -r foo", "sudo rm -rf foo", "cd /tmp && rm -rf foo",
        "bash -c 'rm -rf /tmp/foo'", 'sh -c "git push origin --force"', "git reset --hard",
        "git reset --hard HEAD", "git clean -fd", "git clean --force", 'git commit --no-verify -m "x"',
        "git add .env", "git add apps/api/.env", "git add -f .env.local", 'node -p "process.env.SECRET"',
        'echo "$(rm -rf /tmp/x)"',
    ):
        hook("deny", cmd)


def flow_checks(tmp: Path):
    home = tmp / "home"
    home.mkdir()
    (home / ".gitconfig").touch()
    os.environ.update(HOME=str(home), GIT_CONFIG_GLOBAL=str(home / ".gitconfig"), GIT_CONFIG_NOSYSTEM="1",
                      GH_LOG=str(tmp / "gh.log"), GH_BODY=str(tmp / "gh-body.md"))
    gh_log = tmp / "gh.log"
    gh_log.write_text("")
    bin_dir = tmp / "bin"
    bin_dir.mkdir()
    fake_gh = bin_dir / "gh"
    fake_gh.write_text(
        "#!/usr/bin/env python3\n"
        "import os, shutil, sys\n"
        "args = sys.argv[1:]\n"
        "open(os.environ['GH_LOG'], 'a').write(' '.join(args) + '\\n')\n"
        "if '--body-file' in args:\n"
        "    shutil.copy(args[args.index('--body-file') + 1], os.environ['GH_BODY'])\n"
        "if args[:2] == ['pr', 'list']:\n"
        "    print(os.environ.get('GH_OPEN', '[]'))\n"
        "    sys.exit(0)\n"
        "if args[:2] == ['pr', 'create']:\n"
        "    print('https://github.com/example/demo/pull/7')\n"
        "    sys.exit(0)\n"
        "print('unexpected gh: ' + ' '.join(args), file=sys.stderr)\n"
        "sys.exit(1)\n")
    fake_gh.chmod(0o755)
    os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ['PATH']}"

    def identity(repo):
        git("-C", repo, "config", "user.email", "test@example.com")
        git("-C", repo, "config", "user.name", "Test")

    src, remote, demo = tmp / "src", tmp / "remote.git", tmp / "demo"
    git("init", "-q", "-b", "master", src)
    identity(src)
    (src / "README.md").write_text("hello\n")
    (src / ".env.example").write_text("EXAMPLE=1\n")
    (src / ".gitignore").write_text(".env\n.env.*\n!.env.example\n.envrc\n")
    git("-C", src, "add", "README.md", ".env.example", ".gitignore")
    git("-C", src, "commit", "-q", "-m", "chore: init")
    git("init", "-q", "--bare", "-b", "master", remote)
    git("-C", src, "remote", "add", "origin", remote)
    git("-C", src, "push", "-q", "-u", "origin", "HEAD")
    git("clone", "-q", remote, demo)
    identity(demo)
    git("-C", demo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")

    secrets = {".env": "SUPER_SECRET_VALUE_xyz", "apps/api/.env": "NESTED_SECRET_VALUE_xyz",
               ".env.local": "LOCAL_SECRET_VALUE_xyz", "apps/web/.env.production": "PROD_SECRET_VALUE_xyz",
               ".envrc": "DIRENV_SECRET_VALUE_xyz"}
    for rel, value in secrets.items():
        (demo / rel).parent.mkdir(parents=True, exist_ok=True)
        (demo / rel).write_text(value + "\n")
    body_file = tmp / "body.md"
    body_file.write_text("Closes #12\n\n"
                         "Branch name : feature/12-link-env\n\n## Steps\n\n1. Link env files.\n")
    title, branch = "feat(env): link nested env files", "feature/12-link-env"
    wt = tmp / "demo-12-link-env"

    def main_cmd(*extra, repo=demo, br=branch):
        return [sys.executable, MAIN, "--repo", repo, "--title", title, "--branch", br, *extra]

    def no_secret(*texts):
        for text in texts:
            check(not any(v in text for v in secrets.values()), "output contained env file contents")

    # Dry-run creates nothing and lists the nested env files.
    dry = run(main_cmd("--dry-run", "--body-file", body_file))
    check(dry.returncode == 0, f"dry-run exited {dry.returncode}: {dry.stderr}")
    check(not wt.exists(), "dry-run created the worktree")
    check(run(["git", "-C", demo, "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"]).returncode != 0,
          "dry-run created the branch")
    check(not gh_log.read_text(), "dry-run called gh")
    data = json.loads(dry.stdout)
    check(data["dry_run"] is True and data["pr_url"] is None and data["base"] == "master", "dry-run summary")
    paths = {i["path"]: i["action"] for i in data["env_files"]}
    for rel in secrets:
        check(paths.get(rel) == "would-link", f"dry-run {rel}: {paths.get(rel)}")
    check(".env.example" not in paths, "dry-run listed a tracked file")
    no_secret(dry.stdout, dry.stderr)

    # Full run, body on stdin.
    full = run(main_cmd("--body-file", "-"), input=body_file.read_text())
    check(full.returncode == 0, f"create_pr exited {full.returncode}: {full.stderr}")
    no_secret(full.stdout, full.stderr)
    data = json.loads(full.stdout)
    check(data["ok"] and not data["dry_run"], "summary flags")
    check(data["pr_url"] == "https://github.com/example/demo/pull/7", f"pr_url {data['pr_url']}")
    check(data["worktree"] == os.path.realpath(wt), "worktree path")
    check(data["trusted"] is True, "worktree not trusted")
    check("notion" not in data, "summary still has notion")
    paths = {i["path"]: i["action"] for i in data["env_files"]}
    for rel in secrets:
        check(paths.get(rel) == "linked", f"{rel}: {paths.get(rel)}")
        dest = wt / rel
        check(dest.is_symlink() and os.path.samefile(dest, demo / rel), f"{rel} is not linked to the source")
    example = wt / ".env.example"
    check(example.is_file() and not example.is_symlink(), ".env.example was replaced")
    projects = json.loads((home / ".claude.json").read_text())["projects"]
    check(projects[os.path.realpath(wt)]["hasTrustDialogAccepted"] is True, "trust not written")
    check(git("-C", wt, "log", "-1", "--format=%s") == title, "commit subject")
    check(git("-C", wt, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") == f"origin/{branch}",
          "upstream")
    check(f"Branch name : {branch}" in (tmp / "gh-body.md").read_text(), "PR body")
    log = gh_log.read_text()
    check("--base master" in log and f"--title {title}" in log, f"gh args: {log}")

    # Collision with no open pull request names every existing thing and deletes nothing.
    col = run(main_cmd("--body-file", body_file))
    check(col.returncode == 4, f"collision exited {col.returncode}: {col.stderr}")
    for word in ("local branch", "remote branch", "directory", "worktree", "not a resume"):
        check(word in col.stderr, f"collision did not name {word}")
    check((wt / ".env").is_symlink(), "collision replaced the env symlink")
    check(gh_log.read_text().count("pr create") == 1, "collision created another pull request")

    # Resume: one open pull request and the worktree on the branch reuse both, create nothing.
    os.environ["GH_OPEN"] = '[{"url": "https://github.com/example/demo/pull/7"}]'
    head_before = git("-C", wt, "rev-parse", "HEAD")
    res = run(main_cmd("--body-file", body_file))
    check(res.returncode == 0, f"resume exited {res.returncode}: {res.stderr}")
    data = json.loads(res.stdout)
    check(data["resumed"] is True and data["pr_url"] == "https://github.com/example/demo/pull/7", "resume summary")
    check(git("-C", wt, "rev-parse", "HEAD") == head_before, "resume made a commit")
    check(gh_log.read_text().count("pr create") == 1, "resume created another pull request")
    no_secret(res.stdout, res.stderr)
    pure = run([sys.executable, MAIN, "--repo", demo, "--branch", branch, "--resume"])
    check(pure.returncode == 0 and json.loads(pure.stdout)["resumed"] is True, f"--resume: {pure.stderr}")
    mixed = run([sys.executable, MAIN, "--repo", demo, "--branch", branch, "--resume", "--title", title])
    check(mixed.returncode == 2 and "--resume" in mixed.stderr, f"--resume with title: {mixed.stderr}")
    gone = run([sys.executable, MAIN, "--repo", demo, "--branch", "feature/88-renamed-card", "--resume"])
    check(gone.returncode == 4 and "nothing to resume" in gone.stderr, f"--resume no branch: {gone.stderr}")
    check(gh_log.read_text().count("pr create") == 1, "--resume created a pull request")
    os.environ["GH_OPEN"] = '[{"url": "a"}, {"url": "b"}]'
    two = run(main_cmd("--body-file", body_file))
    check(two.returncode == 4 and "2 open pull requests" in two.stderr, f"two open PRs: {two.stderr}")
    os.environ.pop("GH_OPEN")

    # Card fields build a clean, capped branch.
    card = [sys.executable, MAIN, "--repo", demo, "--title", title, "--dry-run", "--body-file", body_file,
            "--type", "story", "--id", "14",
            "--name", "Recognise my deployed workflows by their n8n id, recorded in my project"]
    slug = run(card)
    check(slug.returncode == 0, f"card dry-run exited {slug.returncode}: {slug.stderr}")
    check(json.loads(slug.stdout)["branch"] == "feature/14-recognise-my-deployed-workflows-by-their-n8n-id",
          f"card branch: {slug.stdout}")
    accents = run(card[:-6] + ["--type", "bug", "--id", "APP-3", "--name", "Écran « Paiement » cassé !"])
    check(json.loads(accents.stdout)["branch"] == "fix/app-3-ecran-paiement-casse", f"accents: {accents.stdout}")
    spike = run(card[:-6] + ["--type", "investigation", "--id", "21", "--name", "Reproduce deploy crash"])
    check(json.loads(spike.stdout)["branch"] == "spike/21-reproduce-deploy-crash", f"investigation: {spike.stdout}")
    token_body = tmp / "token.md"
    token_body.write_text("Closes #9\n\nBranch name : {{BRANCH}}\n")
    git("-C", demo, "worktree", "prune")
    made = run([sys.executable, MAIN, "--repo", demo, "--title", title, "--body-file", "-",
                "--type", "tech story", "--id", "T-9", "--name", "Token fill"], input=token_body.read_text())
    check(made.returncode == 0, f"token run exited {made.returncode}: {made.stderr}")
    check(json.loads(made.stdout)["branch"] == "tech/t-9-token-fill", f"token branch: {made.stdout}")
    check("Branch name : tech/t-9-token-fill" in (tmp / "gh-body.md").read_text(), "body token not filled")
    both = run(card + ["--branch", "feature/x"])
    check(both.returncode == 2 and "not both" in both.stderr, f"branch and card: {both.stderr}")
    empty = run(card[:-2] + ["--name", "!!!"])
    check(empty.returncode == 2 and "title" in empty.stderr, f"empty title: {empty.stderr}")

    # An existing regular file is left untouched. A missing nested file is linked.
    manual = tmp / "demo-manual"
    git("-C", demo, "worktree", "add", "-q", "-b", "feature/77-manual", manual, "HEAD")
    (manual / ".env").write_text("KEEP_ME\n")
    tsv = run([sys.executable, LINKER, "--source", demo, "--dest", manual])
    check(tsv.returncode == 0, f"linker exited {tsv.returncode}")
    check(not (manual / ".env").is_symlink() and (manual / ".env").read_text() == "KEEP_ME\n",
          "linker replaced an existing file")
    check(os.path.samefile(manual / "apps/api/.env", demo / "apps/api/.env"), "nested file not linked")
    check("skipped\t.env\texists" in tsv.stdout and "linked\tapps/api/.env\t" in tsv.stdout, "linker TSV")
    check("NESTED_SECRET" not in tsv.stdout + tsv.stderr and "KEEP_ME" not in tsv.stdout, "linker leaked")

    # Missing origin/HEAD stops before creating anything. followRemoteHEAD=never
    # keeps fetch from restoring the ref the test deletes.
    nohead = tmp / "nohead"
    git("clone", "-q", remote, nohead)
    identity(nohead)
    git("-C", nohead, "config", "remote.origin.followRemoteHEAD", "never")
    git("-C", nohead, "remote", "set-head", "origin", "-d")
    res = run(main_cmd("--body-file", body_file, repo=nohead, br="feature/44-no-head"))
    check(res.returncode == 3 and "origin/HEAD is unset" in res.stderr, f"no origin/HEAD: {res.stderr}")
    check(not (tmp / "nohead-44-no-head").exists(), "created a worktree without origin/HEAD")

    # A fetch failure also stops before creating anything.
    bad = tmp / "badremote"
    git("clone", "-q", remote, bad)
    identity(bad)
    git("-C", bad, "remote", "set-url", "origin", tmp / "does-not-exist.git")
    res = run(main_cmd("--body-file", body_file, repo=bad, br="feature/45-bad-remote"))
    check(res.returncode == 3 and "git fetch origin failed" in res.stderr, f"bad remote: {res.stderr}")
    check(not (tmp / "badremote-45-bad-remote").exists(), "created a worktree after fetch failed")

    usage = run([sys.executable, MAIN])
    check(usage.returncode == 2 and usage.stderr.startswith("error:"), f"usage: {usage.stderr}")
    helped = run([sys.executable, MAIN, "--help"])
    check(helped.returncode == 0 and "exit 4" in helped.stdout, "--help lacks the exit codes")


def main() -> int:
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    static_checks()
    hook_checks()
    tmp = Path(tempfile.mkdtemp(prefix="test-create-pr."))
    saved = dict(os.environ)
    try:
        flow_checks(tmp)
    finally:
        os.environ.clear()
        os.environ.update(saved)
        shutil.rmtree(tmp, ignore_errors=True)
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
