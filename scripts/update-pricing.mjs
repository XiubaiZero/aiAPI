/** Refresh each provider independently using only its official public pages. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  discoverOpenAI, discoverAnthropic, discoverGeminiIndex,
  parseGeminiDetail, parseGeminiPrice, geminiCandidate, reconcileProvider,
} from './catalog-core.mjs'

const root = resolve(import.meta.dirname, '..')
const priceFile = resolve(root, 'src/data/pricing.json')
const rateFile = resolve(root, 'src/data/exchange-rate.json')
const now = new Date()
const checkedAt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(now).replace(' ', 'T') + '+08:00'

const sources = {
  OpenAI: 'https://developers.openai.com/api/docs/models',
  Anthropic: 'https://platform.claude.com/docs/en/models/overview',
  geminiModels: 'https://ai.google.dev/gemini-api/docs/models?hl=en',
  geminiPricing: 'https://ai.google.dev/gemini-api/docs/pricing?hl=en',
  pbcList: 'https://www.pbc.gov.cn/zhengcehuobisi/125207/125217/125925/17105-1.html',
}

async function fetchOfficial(label, url) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'AI-API-Price-Assistant/2.0 official-source-checker' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${url}`)
      return response.text()
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, [2_000, 5_000][attempt]))
    }
  }
  throw new Error(`${label} unavailable after three attempts: ${lastError.message}`)
}

function plainText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
}

async function updateRate(previous) {
  const list = await fetchOfficial('PBC exchange-rate list', sources.pbcList)
  const link = list.match(/href="([^"]+)"[^>]*>[^<]*人民币汇率中间价公告/)
  if (!link) throw new Error('PBC latest central-parity announcement link not found')
  const url = new URL(link[1], sources.pbcList).toString()
  const announcement = plainText(await fetchOfficial('PBC exchange-rate announcement', url))
  const value = announcement.match(/1美元对人民币\s*([\d.]+)元/)
  const date = announcement.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!value || !date || !(Number(value[1]) > 0)) throw new Error('PBC USD/CNY rate or date not found')
  return { ...previous, usdToCny: Number(value[1]), sourceUrl: url, checkedAt,
    effectiveDate: `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` }
}

async function main() {
  let catalog = JSON.parse(await readFile(priceFile, 'utf8'))
  const rate = JSON.parse(await readFile(rateFile, 'utf8'))
  const fetched = await Promise.allSettled([
    fetchOfficial('OpenAI models', sources.OpenAI),
    fetchOfficial('Anthropic models', sources.Anthropic),
    fetchOfficial('Gemini models', sources.geminiModels),
    fetchOfficial('Gemini pricing', sources.geminiPricing),
  ])
  const issues = []
  const providerStatus = { ...catalog.providerStatus }
  let verifiedCount = 0

  for (const [provider, index, discover] of [
    ['OpenAI', 0, (html) => discoverOpenAI(html, sources.OpenAI)],
    ['Anthropic', 1, (html) => discoverAnthropic(html, sources.Anthropic)],
  ]) {
    try {
      if (fetched[index].status === 'rejected') throw fetched[index].reason
      const candidates = discover(fetched[index].value)
      catalog = { ...catalog, ...reconcileProvider(catalog, provider, candidates, checkedAt) }
      verifiedCount += candidates.filter((item) => item.record).length
      const failed = candidates.filter((item) => item.error)
      if (failed.length) issues.push({ provider, message: `${failed.length} 个模型缺少可核验的数据` })
      providerStatus[provider] = { checkedAt: failed.length ? providerStatus[provider]?.checkedAt ?? null : checkedAt,
        lastAttemptAt: checkedAt }
    } catch (error) {
      issues.push({ provider, message: error.message })
      providerStatus[provider] = { checkedAt: providerStatus[provider]?.checkedAt ?? null, lastAttemptAt: checkedAt }
    }
  }

  try {
    if (fetched[2].status === 'rejected') throw fetched[2].reason
    if (fetched[3].status === 'rejected') throw fetched[3].reason
    const items = discoverGeminiIndex(fetched[2].value)
    const candidates = await Promise.all(items.map(async (item) => {
      try {
        const detail = await fetchOfficial(item.id, `https://ai.google.dev/gemini-api/docs/models/${item.id}?hl=en`)
        const limits = parseGeminiDetail(detail, item.id)
        const price = parseGeminiPrice(fetched[3].value, item.id, now)
        return { id: item.id, record: geminiCandidate(item, price, limits, sources.geminiPricing) }
      } catch (error) { return { ...item, error: error.message } }
    }))
    catalog = { ...catalog, ...reconcileProvider(catalog, 'Gemini', candidates, checkedAt) }
    verifiedCount += candidates.filter((item) => item.record).length
    const failed = candidates.filter((item) => item.error)
    if (failed.length) issues.push({ provider: 'Gemini', message: `${failed.length} 个模型缺少可核验的数据` })
    providerStatus.Gemini = { checkedAt: failed.length ? providerStatus.Gemini?.checkedAt ?? null : checkedAt,
      lastAttemptAt: checkedAt }
  } catch (error) {
    issues.push({ provider: 'Gemini', message: error.message })
    providerStatus.Gemini = { checkedAt: providerStatus.Gemini?.checkedAt ?? null, lastAttemptAt: checkedAt }
  }

  let nextRate = null
  try { nextRate = await updateRate(rate) } catch (error) {
    issues.push({ provider: 'PBC', message: error.message })
  }
  catalog = { ...catalog, updatedAt: verifiedCount ? checkedAt : catalog.updatedAt,
    lastRunAt: checkedAt, providerStatus, issues }
  await writeFile(priceFile, `${JSON.stringify(catalog, null, 2)}\n`)
  if (nextRate) await writeFile(rateFile, `${JSON.stringify(nextRate, null, 2)}\n`)
  console.log(`Verified ${verifiedCount} official model records at ${checkedAt}; ${catalog.models.length} current, ${catalog.archivedModels?.length ?? 0} archived.`)
  for (const issue of issues) console.warn(`[${issue.provider}] ${issue.message}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
