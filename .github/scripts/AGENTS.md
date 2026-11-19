# AGENTS.md — .github/scripts

Scripts that GitHub Actions workflows run. A workflow step calls one script (`run: python3 .github/scripts/<script>.py`) instead of inline shell.

## Prohibitions

- Python 3 standard library only: no `pip install`, no `requirements.txt`. The runner's `python3` must run the script as is, and the local check must pass on Python 3.10.
- A script never publishes, tags, releases or pushes by itself unless its workflow step exists to do exactly that. Read-only checks (`npm view`, `git ls-remote`, `gh release view`) are fine.
- Do not run a script locally against the real `GITHUB_OUTPUT` of a workflow, or with credentials that can publish.

## Shape

- One script per workflow step, named after it: `release_check.py` for the `check` step of `release.yml`.
- The decisions live in pure functions that take values and return values (`changelog_section`, `plan`, `render`). `main()` does the I/O: environment, files, subprocesses, `$GITHUB_OUTPUT`, `$GITHUB_STEP_SUMMARY`.
- A step output is a `key=value` line appended to `$GITHUB_OUTPUT`. Booleans are written `true` / `false`, as the workflow's `if:` compares them to `'true'`.

## Tests

- Tests sit in `test_<area>.py` next to the scripts, with `unittest`, and call the pure functions. Method names read `test_should_{outcome}_when_{condition}`; the body is given, when, then, separated by blank lines (`docs/testing.md`).
- Run them before handing work back: `python3 -m unittest discover -s .github/scripts`. `npm run verify` does not run them, and no CI job does.

## Example

- `.github/scripts/release_check.py` and `.github/scripts/test_release.py`
