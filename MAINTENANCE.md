# Maintenance

- `packages/mcp-server` is the published MCP entrypoint; transaction execution remains in `packages/runtime`.
- Every value-moving tool must quote first, bind execution to its preview, and require an explicit `yes` or `ya`.
- Keep private keys and persistent previews under `~/.arcox`; never add them to this repository.
- Validate changes with `npm run check` before publishing.
