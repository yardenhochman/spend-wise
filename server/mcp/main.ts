/** SpendWise MCP entry point. Runbook: docs/runbooks/mcp.md. */
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import Database from 'better-sqlite3'
import { todayInIsrael } from '../lib/home/dates.js'
import { readMortgageSnapshot } from '../lib/home/service.js'
import { spendWiseConfig } from '../lib/private-config.js'
import { createViewModeFilter } from '../lib/view-mode.js'
import { createApp } from './server.js'

export function openReadOnly(file: string): Database.Database {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  db.pragma('query_only = ON')
  return db
}

export function readToken(file: string): string {
  if ((fs.statSync(file).mode & 0o077) !== 0)
    throw new Error(`${file} must be readable only by its owner`)
  const token = fs.readFileSync(file, 'utf8').trim()
  if (token.length < 32)
    throw new Error(`${file} must hold at least 32 characters`)
  return token
}

function main() {
  const tokenFile = process.env.SPENDWISE_MCP_TOKEN_FILE
  if (!tokenFile) throw new Error('SPENDWISE_MCP_TOKEN_FILE is required')
  const port = Number(process.env.SPENDWISE_MCP_PORT ?? 17480)
  const db = openReadOnly(
    process.env.SPENDWISE_DB_PATH ??
      path.resolve(process.cwd(), 'data/spend-wise.sqlite'),
  )
  const lookup = db.prepare('SELECT id FROM categories WHERE name = ?')
  const buildViewModeFilter = createViewModeFilter(
    (name) => (lookup.get(name) as { id: string } | undefined)?.id ?? null,
  )
  const log = (line: string) => console.log(line)
  const app = createApp({
    deps: {
      db,
      routineFilter: () => buildViewModeFilter('routine', 't'),
      config: spendWiseConfig.household,
      today: todayInIsrael,
      mortgage: readMortgageSnapshot,
    },
    token: readToken(tokenFile),
    allowedHosts: (process.env.SPENDWISE_MCP_ALLOWED_HOSTS ?? '127.0.0.1')
      .split(',')
      .map((host) => host.trim().toLowerCase()),
    log,
  })
  const started = () => log(`listening port=${port}`)
  const { SPENDWISE_MCP_BIND, SPENDWISE_MCP_TLS_CERT, SPENDWISE_MCP_TLS_KEY } =
    process.env
  // Plain HTTP stays on loopback. The tailnet address is only served over TLS.
  if (SPENDWISE_MCP_BIND && SPENDWISE_MCP_TLS_CERT && SPENDWISE_MCP_TLS_KEY)
    https
      .createServer(
        {
          cert: fs.readFileSync(SPENDWISE_MCP_TLS_CERT),
          key: fs.readFileSync(SPENDWISE_MCP_TLS_KEY),
        },
        app,
      )
      .listen(port, SPENDWISE_MCP_BIND, started)
  else app.listen(port, '127.0.0.1', started)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename)
  main()
