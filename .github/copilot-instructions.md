# TillDeals workspace instructions

- Before packaging or deploying, check the current `version` in `package.json` and report it.
- `npm run deploy:win` automatically bumps the patch version. Pass `minor` or `major` when that release level is intended; use `--dry-run` to preview the change.
- After deployment, verify the artifact filename and checksum.
- Before removing or hiding an existing UI section, ask the user for confirmation unless they explicitly requested its removal.
