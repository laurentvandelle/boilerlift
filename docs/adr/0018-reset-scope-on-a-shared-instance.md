# `lift reset` removes the target's entries and the removed workflows, and keeps other targets' entries

`lift reset --target <name>` removes every workflow Boilerlift recorded as deployed for one target. The lock file is keyed by instance, not by target (ADR 0009, ADR 0016), so it cannot say which target deployed an entry when several targets share an instance. Reset therefore removes the entries whose stable name has a file in the target's folder, plus the removed workflows (an entry with no file in the folder of any target on that instance), and keeps every entry whose stable name has a file in the folder of another target on the instance, even when the target's own folder has it too. It reads the folders of every target on the instance to tell them apart, and it runs only on a target named with `--target`: never `--all`, never the implicit single target.

## Considered options

- Refuse a reset when another target shares the instance: it would block the shared setups, such as dev and staging on one server, that reset is meant for.
- Remove every entry of the instance: it would destroy another target's deploys.
- Record the target in each lock entry: it changes the lock file format for one command.
