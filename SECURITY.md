# Security policy

## Supported versions

Boilerlift is in early development. Only the latest published version on npm receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through [GitHub private vulnerability reporting](https://github.com/laurentvandelle/boilerlift/security/advisories/new). Include:

- what the vulnerability is and what an attacker could do with it,
- steps or a proof of concept to reproduce it,
- the Boilerlift, Node.js and n8n versions involved.

You should get a first answer within 7 days. Once a fix is released, the advisory is published and you are credited unless you prefer otherwise.

## Scope

Boilerlift talks to your own n8n instance with an API key you provide. Reports about how Boilerlift reads, stores, logs or sends that key, or about workflows it delivers that differ from the source, are in scope. Vulnerabilities in n8n itself should go to the [n8n project](https://github.com/n8n-io/n8n/security).
