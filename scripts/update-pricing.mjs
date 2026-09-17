/**
 * Daily official-source updater.
 * It intentionally rejects incomplete parsing rather than replacing verified data
 * with data from an aggregator or an inferred value.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const priceFile = resolve(root, 'src/data/pricing.json')
const rateFile = resolve(root, 'src/data/exchange-rate.json')
const now = new Date()
const checkedAt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(now).replace(' ', 'T') + '+08:00'

const officialSources = {
  openai: 'https://developers.openai.com/api/docs/models',
  anthropic: 'https://platform.claude.com/docs/en/models/overview',
  geminiPricing: 'https://ai.google.dev/gemini-api/docs/pricing?hl=en',
  geminiModels: 'https://ai.google.dev/gemini-api/docs/models?hl=en',
  pbcList: 'https://www.pbc.gov.cn/zhengcehuobisi/125207/125217/125925/17105-2.html',
}

async function fetchOfficial(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'AI-API-Price-Assistant/1.0 official-source-checker' } })
  if (!response.ok) throw new Error(`Official source returned ${response.status}: ${url}`)
  return response.text()
}

function plainText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
}

function modelSlice(text, anchor, length = 2400) {
  const index = text.toLowerCase().indexOf(anchor.toLowerCase())
  if (index < 0) throw new Error(`Could not find official model anchor: ${anchor}`)
  return text.slice(index, index + length)
}

function capturePrice(slice, inputPattern, outputPattern) {
  const input = slice.match(inputPattern)?.[1]
  const output = slice.match(outputPattern)?.[1]
  if (!input || !output) throw new Error(`Could not parse official input/output prices from: ${slice.slice(0, 180)}`)
  return { input: Number(input), output: Number(output) }
}

function contextToTokens(value, unit) {
  const number = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(number)) throw new Error('Invalid context window')
  return unit.toLowerCase() === 'm' ? number * 1_000_000 : unit.toLowerCase() === 'k' ? number * 1_000 : number
}

function captureLimit(slice, label) {
  const match = slice.match(new RegExp(`${label}\\s*([\\d,.]+)\\s*([kKmM])?`, 'i'))
  if (!match) throw new Error(`Could not parse official ${label}`)
  return contextToTokens(match[1], match[2] || '')
}

function parseOpenAi(text, id) {
  const slice = modelSlice(text, id)
  const price = capturePrice(slice, /Input price\s*\$([\d.]+)/i, /Output price\s*\$([\d.]+)/i)
  return { ...price, inputContextTokens: captureLimit(slice, 'Context window'), outputContextTokens: captureLimit(slice, 'Max output') }
}

function parseAnthropic(text, modelColumn) {
  // Anthropic's comparison table lists all current models as columns. Parse
  // the matching column rather than searching after a model heading, which
  // would otherwise capture the first model's price in the row.
  const table = modelSlice(text, 'Comparative latency', 2600)
  const pricePairs = [...table.matchAll(/\$([\d.]+)\s*\/\s*input\s*MTok\s*\$([\d.]+)\s*\/\s*output\s*MTok/gi)]
  const contextRow = table.slice(table.indexOf('Context window'), table.indexOf('Max output'))
  const outputRow = table.slice(table.indexOf('Max output'), table.indexOf('Reliable knowledge cutoff'))
  const contexts = [...contextRow.matchAll(/([\d.]+)\s*([kKmM])\s*tokens/gi)]
  const outputs = [...outputRow.matchAll(/([\d.]+)\s*([kKmM])\s*tokens/gi)]
  const price = pricePairs[modelColumn]
  const context = contexts[modelColumn]
  const output = outputs[modelColumn]
  if (!price || !context || !output) throw new Error(`Could not parse Anthropic table column ${modelColumn}`)
  return {
    input: Number(price[1]), output: Number(price[2]),
    inputContextTokens: contextToTokens(context[1], context[2]),
    outputContextTokens: contextToTokens(output[1], output[2]),
  }
}

function parseGemini(text, label) {
  const slice = modelSlice(text, label, 3600)
  const price = capturePrice(slice, /Input price[\s\S]{0,220}?\$([\d.]+)/i, /Output price[\s\S]{0,220}?\$([\d.]+)/i)
  return { ...price }
}

function assertSafeRecord(record) {
  for (const value of [record.input, record.output, record.inputContextTokens, record.outputContextTokens]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Parsed an invalid value for ${record.id}`)
  }
}

async function update() {
  const [catalog, rate, openaiHtml, anthropicHtml, geminiPricingHtml, geminiModelsHtml, pbcListHtml] = await Promise.all([
    readFile(priceFile, 'utf8').then(JSON.parse), readFile(rateFile, 'utf8').then(JSON.parse),
    fetchOfficial(officialSources.openai), fetchOfficial(officialSources.anthropic), fetchOfficial(officialSources.geminiPricing),
    fetchOfficial(officialSources.geminiModels), fetchOfficial(officialSources.pbcList),
  ])
  const openai = plainText(openaiHtml)
  const anthropic = plainText(anthropicHtml)
  const geminiPricing = plainText(geminiPricingHtml)
  const geminiModels = plainText(geminiModelsHtml)
  const latestLink = pbcListHtml.match(/href="([^"]+)"[^>]*>[^<]*人民币汇率中间价公告/)
  if (!latestLink) throw new Error('Could not find the latest PBC central-parity announcement link')
  const latestPbcUrl = new URL(latestLink[1], officialSources.pbcList).toString()
  const latestPbc = plainText(await fetchOfficial(latestPbcUrl))

  const parsers = {
    'gpt-6-astra': () => parseOpenAi(openai, 'gpt-6-astra'),
    'gpt-5.6-terra': () => parseOpenAi(openai, 'gpt-5.6-terra'),
    'gpt-5.6-luna': () => parseOpenAi(openai, 'gpt-5.6-luna'),
    'claude-opus-5': () => parseAnthropic(anthropic, 1),
    'claude-sonnet-5': () => parseAnthropic(anthropic, 2),
    'claude-haiku-4-5': () => parseAnthropic(anthropic, 3),
    // The official overview lists all three Gemini IDs. Price information is
    // parsed from the official pricing table; stable context limits remain
    // in the curated record unless an individual model page is added here.
    'gemini-3.1-pro-preview': () => { modelSlice(geminiModels, 'Gemini 3.1 Pro'); return parseGemini(geminiPricing, 'Gemini 3.1 Pro') },
    'gemini-3.8-flash': () => { modelSlice(geminiModels, 'Gemini 3.8 Flash'); return parseGemini(geminiPricing, 'Gemini 3.8 Flash') },
    'gemini-3.1-flash-lite': () => { modelSlice(geminiModels, 'Gemini 3.1 Flash-Lite'); return parseGemini(geminiPricing, 'Gemini 3.1 Flash-Lite') },
  }

  const models = catalog.models.map((model) => {
    const parsed = parsers[model.id]?.()
    if (!parsed) throw new Error(`No official parser registered for ${model.id}`)
    const verified = {
      id: model.id,
      ...parsed,
      inputContextTokens: parsed.inputContextTokens ?? model.inputContextTokens,
      outputContextTokens: parsed.outputContextTokens ?? model.outputContextTokens,
    }
    assertSafeRecord(verified)
    return {
      ...model,
      inputPricePerMillionUsd: parsed.input,
      outputPricePerMillionUsd: parsed.output,
      inputContextTokens: verified.inputContextTokens,
      outputContextTokens: verified.outputContextTokens,
      checkedAt,
    }
  })

  const pbcMatch = latestPbc.match(/1美元对人民币\s*([\d.]+)元/)
  if (!pbcMatch) throw new Error('Could not parse USD/CNY reference rate from the official PBC source list')
  const pbcDate = latestPbc.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!pbcDate) throw new Error('Could not parse the effective date from the official PBC announcement')
  const effectiveDate = `${pbcDate[1]}-${pbcDate[2].padStart(2, '0')}-${pbcDate[3].padStart(2, '0')}`
  const usdToCny = Number(pbcMatch[1])
  if (!Number.isFinite(usdToCny) || usdToCny <= 0) throw new Error('Parsed invalid USD/CNY reference rate')

  await writeFile(priceFile, `${JSON.stringify({ ...catalog, updatedAt: checkedAt, models }, null, 2)}\n`)
  await writeFile(rateFile, `${JSON.stringify({ ...rate, usdToCny, sourceUrl: latestPbcUrl, checkedAt, effectiveDate }, null, 2)}\n`)
  console.log(`Verified and updated ${models.length} official model records at ${checkedAt}.`)
}

update().catch((error) => { console.error(error); process.exitCode = 1 })
