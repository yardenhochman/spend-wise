# SpendWise MCP runbook

Product rules: [SPEC-020](../../specs/SPEC-020-agent-access.md). Code: `server/mcp/`.

## Install on the machine holding the database

The service serves its own HTTPS on the tailnet address, with a `tailscale cert`
renewed at each start. It restarts weekly. `tailscale serve` is not used, because
changing its config needs sudo on this machine, and Funnel is never used without
Yarden's approval. If it is ever fronted by Funnel, the server answers 403.

```sh
install -d -m 700 ~/.config/spendwise-mcp
(umask 077; openssl rand -hex 32 > ~/.config/spendwise-mcp/token)
# Private names stay out of this public repo.
cat > ~/.config/spendwise-mcp/env <<ENV
SPENDWISE_MCP_TAILNET_HOST=<machine>.<tailnet>.ts.net
SPENDWISE_MCP_BIND=$(tailscale ip -4)
SPENDWISE_MCP_ALLOWED_HOSTS=<machine>.<tailnet>.ts.net
ENV
systemctl --user link ~/dev/spend-wise/deploy/spendwise-mcp.service
systemctl --user enable --now spendwise-mcp
```

## Add a client

Register per project, not per user: a chat that reads untrusted pages should not
also hold household data. From the project directory:

```sh
claude mcp add-json --scope local spendwise \
  '{"type":"http","url":"https://<machine>.<tailnet>.ts.net:17480/mcp","headersHelper":"'"$HOME"'/dev/spend-wise/deploy/spendwise-mcp-headers.sh"}'
```

The project must already be trusted in Claude Code: `headersHelper` does not run
otherwise, and the failure reads as a 401. Accept the trust dialog there once.

Another machine needs its own copy of the helper and token file. claude.ai
connectors cannot reach a tailnet-only server.

## Check it

```sh
systemctl --user status spendwise-mcp
journalctl --user -u spendwise-mcp -n 20   # tool and argument names, row data never
curl -s -o /dev/null -w '%{http_code}\n' https://<machine>.<tailnet>.ts.net:17480/health   # 401
```

## Rotate or stop

Replace the token file, then `systemctl --user restart spendwise-mcp`. To stop:
`systemctl --user disable --now spendwise-mcp`.
