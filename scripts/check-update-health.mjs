import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve(import.meta.dirname, '../src/data/pricing.json')
const catalog = JSON.parse(await readFile(path, 'utf8'))
const issues = catalog.issues ?? []
if (issues.length || catalog.pendingModels?.length) {
  for (const issue of issues) console.error(`[${issue.provider}] ${issue.message}`)
  for (const model of catalog.pendingModels ?? []) console.error(`[${model.provider}/${model.id}] ${model.reason}`)
  process.exitCode = 1
} else {
  console.log('All discovered official models were verified.')
}
