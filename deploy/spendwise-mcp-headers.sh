#!/bin/sh
# Claude Code headersHelper: prints the bearer header without putting the token in config or argv.
printf '{"Authorization":"Bearer %s"}\n' "$(cat "$HOME/.config/spendwise-mcp/token")"
