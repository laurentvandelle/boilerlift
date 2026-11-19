# Credential lists are generated, committed project files

`lift creds sync` writes the credentials of each target to `credentials/<target>.ts`, committed with the project, rather than reading them from the instance at deploy time. A workflow then picks a credential with `credential('key')`, and the editor checks the key offline.

Each generated file passes its list to `defineCredentials` and adds its target to the `CredentialLists` interface of `'boilerlift'` by declaration merging, so `credential()` takes the keys of every target without the package importing project files. `defineCredentials` also registers the type of each key at import, which is how `credential()` builds the `{ [type]: marker }` entry at runtime: the CLI imports the lists before the workflow files.

## Considered options

- Fetching the credentials at deploy time: no autocompletion, and a typo is found only against a live instance.
- One merged file for every target: a key would hide that a target lacks it, which is what the missing report is for.
- A `credential()` exported by the generated file instead of `'boilerlift'`: one import per target in every workflow, and a workflow would name its target.
