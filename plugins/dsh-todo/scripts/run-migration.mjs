// One-shot driver: run dsh-todo's real [Service.init] migration against a home.
// Usage: DSH_HOME=<home> node scripts/run-migration.mjs
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service } from '@deepseek-ai/cordis'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)

const { Context } = await import('@deepseek-ai/cordis')
const ctx = new Context()
const service = new host.TodoService(ctx)
await service[Service.init]()
console.log('migration init completed')
