# Backend operational safety

These small helpers extend an existing Windows deployment; they do not bootstrap a
new service, change its database, or replace its private authentication configuration.

## Optional AI estimation

The private launcher calls `read_ai_environment(config_path, live_root)` and adds
only its returned variables to the child environment. Remove any unconditional
`QINGMU_CLAUDE_CLI_PATH` assignment. An absent configuration disables estimation;
nominations, voting and manual pricing remain available.

After validating the real CLI boundary, the private configuration may contain:

```json
{
  "enabled": true,
  "executable": "C:/path/to/claude.exe",
  "boundarySha256": "<SHA256 of the exact verified server/claudeCli.ts bytes>"
}
```

The boundary hash must match the deployed file. Rolling back server code without
changing the hardened launcher disables AI automatically. Never restore the old
unrestricted launcher as part of a server rollback. CLI invocation itself disables
tools, MCP, customizations and persisted sessions while preserving authentication.

## Existing backend restart

The official starter calls `record_successful_start` after a healthy start and
stores its successful receipt in `ops/active-backend.json`. Routine
`ALREADY_RUNNING` results must not erase that process identity. Keep the existing
launcher integrity pin in sync with any private helper changes.

Run `restart_backend.py --live-root <deployment> --port <port> --instance-id <id>
--check-only` before deployment. It binds the live health response, listening PID,
Node process start and successful startup receipt. Missing or changed observations
refuse to stop anything. Omit `--check-only` only after capturing a consistent SQLite
backup and stopping test mutations. The legacy Windows process is terminated after
the same PID/start/port are rechecked, then the existing `ops/start_backend.py`
performs startup. No unrelated processes or service configurations are touched.

Run the bounded operational tests with:

```text
python -m unittest discover -s ops -p "test_*.py" -v
```
