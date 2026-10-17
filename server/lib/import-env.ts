import { createRequire } from 'node:module'

// Synchronous bootstrap preserves the legacy dotenv-before-db import order.
// Broker imports must not read the credential .env at all.
const brokerInput = process.argv.slice(2).some(arg => arg === '--input' || arg.startsWith('--input='))
if (!brokerInput) createRequire(import.meta.url)('dotenv/config')
