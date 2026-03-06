# dkg-docs-server

Standalone MCP server for reading docs from your DKG paranet.

This folder is intentionally isolated and does not require any edits to the rest of the repo.

## What it exposes

- `dkg_docs_list` - list indexed docs (`schema:DigitalDocument`)
- `dkg_docs_search` - keyword search across identifier/name/chunk text
- `dkg_docs_read` - read ordered text chunks for a document

## Requirements

- DKG daemon running (`pnpm dkg start -f` or `pnpm dkg start`)
- Docs already published to your target paranet (default: `testing`)
- Repo dependencies installed (`pnpm install`)

## MCP client config

Use this in your MCP config (Claude Desktop/Cursor/etc.):

```json
{
  "mcpServers": {
    "dkg-docs": {
      "command": "node",
      "args": ["/Users/otlegend/projects/dkg-v9/mcp-docs-server/index.mjs"],
      "env": {
        "DKG_DOCS_PARANET": "testing"
      }
    }
  }
}
```

## Environment variables

- `DKG_DOCS_PARANET` - paranet to query (default: `testing`)
- `DKG_API_PORT` - override daemon API port (otherwise reads `~/.dkg/api.port`)
- `DKG_API_TOKEN` - override auth token (otherwise reads `~/.dkg/auth.token`)
- `DKG_HOME` - override DKG home dir (default: `~/.dkg`)

## Notes

- `dkg_docs_read.identifier` accepts either:
  - a doc identifier (example: `docs/setup/JOIN_TESTNET.md`), or
  - a full document IRI (example: `urn:dkg:doc:...`)
- Read by chunks to keep responses compact.
