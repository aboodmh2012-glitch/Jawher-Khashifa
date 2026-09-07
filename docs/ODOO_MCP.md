# Odoo MCP integration

The project ships a **project-scoped MCP server** named `odoo` that connects
Claude Code (and any MCP-aware client that reads `.mcp.json`) to the FusionLC
Odoo endpoint at `https://fusionlc.com/mcp`.

The configuration lives in [`.mcp.json`](../.mcp.json) at the repo root and is
committed so the whole team shares the same setup. The remote endpoint is
reached through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), which
bridges a local stdio transport to the remote HTTP MCP server.

## Setup

The bearer token is **not** stored in the repo. `.mcp.json` references it via
`${ODOO_MCP_TOKEN}`, which Claude Code expands from your environment at launch.

1. Obtain a FusionLC bearer token.
2. Export it before starting Claude Code:

   ```bash
   export ODOO_MCP_TOKEN="<your-fusionlc-bearer-token>"
   ```

   (`.env.example` documents the same variable. Loading it from `.env`, e.g.
   `set -a; source .env; set +a`, works too — `.env` is git-ignored.)
3. Start Claude Code from the repo root. It reads `.mcp.json` and, on first run,
   asks you to approve the project's MCP servers.
4. Verify the server is connected:

   ```bash
   claude mcp list
   ```

## Equivalent CLI command

The same server can be registered ad hoc (user scope) instead of via
`.mcp.json`:

```bash
claude mcp add --transport stdio odoo -- \
  npx -y mcp-remote https://fusionlc.com/mcp \
  --header "Authorization: Bearer $ODOO_MCP_TOKEN"
```

## Security

- **Never commit the raw token.** Keep it in the environment (or git-ignored
  `.env`), not in `.mcp.json`.
- Treat the token like any other credential — rotate it if it is ever exposed
  (for example, pasted into a chat, a log, or a shell history file).
- Project MCP servers require explicit approval in Claude Code before they run,
  which prevents a checked-in `.mcp.json` from executing without consent.
