export const providers = ['OpenAI', 'Anthropic', 'Gemini']

export function plainText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ')
}

function tokens(value, unit = '') {
  const count = Number(value.replace(/,/g, ''))
  return count * (unit.toLowerCase() === 'm' ? 1_000_000 : unit.toLowerCase() === 'k' ? 1_000 : 1)
}

function valid(candidate) {
  return [candidate.inputPricePerMillionUsd, candidate.outputPricePerMillionUsd,
    candidate.inputContextTokens, candidate.outputContextTokens]
    .every((value) => Number.isFinite(value) && value > 0)
}

function candidate(id, name, provider, sourceUrl, note, values) {
  const record = { id, name, provider, sourceUrl, note, ...values }
  if (!valid(record)) throw new Error(`Incomplete official price or token limits for ${id}`)
  return record
}

export function discoverOpenAI(html, sourceUrl) {
  const text = plainText(html)
  const start = text.indexOf('Flagship models')
  const end = text.indexOf('Specialized models', start)
  if (start < 0 || end < start) throw new Error('OpenAI flagship catalog not found')
  const section = text.slice(start, end)
  const matches = [...section.matchAll(/Model ID\s+(gpt-[a-z0-9.-]+)/gi)]
  if (matches.length < 2) throw new Error('OpenAI flagship catalog is incomplete')
  return matches.map((match, index) => {
    const id = match[1]
    const block = section.slice(match.index, matches[index + 1]?.index ?? section.length)
    const heading = section.slice(index ? matches[index - 1].index + matches[index - 1][0].length : 0, match.index)
    const names = [...heading.matchAll(/GPT-[\d.]+\s+[A-Za-z][A-Za-z-]*/g)]
    const name = names.at(-1)?.[0] ?? id.toUpperCase()
    try {
      const input = block.match(/Input price\s*\$([\d.]+)/i)?.[1]
      const output = block.match(/Output price\s*\$([\d.]+)/i)?.[1]
      const max = block.match(/Max output\s*([\d,.]+)\s*([kKmM])?/i)
      const context = block.match(/Context window\s*([\d,.]+)\s*([kKmM])?/i)
      return { id, record: candidate(id, name, 'OpenAI', sourceUrl,
        '标准文本 token 定价；缓存、Fast 模式及工具调用另计。', {
          inputPricePerMillionUsd: Number(input), outputPricePerMillionUsd: Number(output),
          inputContextTokens: tokens(context?.[1] ?? 'NaN', context?.[2]),
          outputContextTokens: tokens(max?.[1] ?? 'NaN', max?.[2]),
        }) }
    } catch (error) { return { id, name, error: error.message } }
  })
}

export function discoverAnthropic(html, sourceUrl) {
  const text = plainText(html)
  const start = text.indexOf('## Compare models') >= 0 ? text.indexOf('## Compare models') : text.indexOf('Compare models')
  const end = text.indexOf('Using the Models API', start)
  if (start < 0 || end < start) throw new Error('Anthropic comparison table not found')
  const table = text.slice(start, end)
  const heading = table.slice(table.indexOf('Feature'), table.indexOf('Comparative latency'))
  const names = [...heading.matchAll(/Claude\s+[A-Z][a-z]+\s+[\d.]+/g)].map((match) => match[0])
  const idRow = table.slice(table.indexOf('Claude API ID'), table.indexOf('Capabilities'))
  const ids = [...idRow.matchAll(/claude-[a-z0-9-]+/gi)].map((match) => match[0])
  if (ids.length < 2 || names.length !== ids.length) throw new Error('Anthropic model IDs or names are incomplete')
  const prices = [...table.matchAll(/\$([\d.]+)\s*\/\s*input\s*MTok\s*\$([\d.]+)\s*\/\s*output\s*MTok/gi)]
  const contextRow = table.slice(table.indexOf('Context window'), table.indexOf('Max output'))
  const outputRow = table.slice(table.indexOf('Max output'), table.indexOf('Reliable knowledge cutoff'))
  const contexts = [...contextRow.matchAll(/([\d,.]+)\s*([kKmM])\s*tokens/gi)]
  const outputs = [...outputRow.matchAll(/([\d,.]+)\s*([kKmM])\s*tokens/gi)]
  return ids.map((id, index) => {
    try {
      return { id, record: candidate(id, names[index], 'Anthropic', sourceUrl,
        '标准文本 token 定价；Prompt Cache 读写另计。', {
          inputPricePerMillionUsd: Number(prices[index]?.[1]),
          outputPricePerMillionUsd: Number(prices[index]?.[2]),
          inputContextTokens: tokens(contexts[index]?.[1] ?? 'NaN', contexts[index]?.[2]),
          outputContextTokens: tokens(outputs[index]?.[1] ?? 'NaN', outputs[index]?.[2]),
        }) }
    } catch (error) { return { id, name: names[index], error: error.message } }
  })
}

export function discoverGeminiIndex(html) {
  const text = plainText(html)
  const start = text.search(/All Gemini [\d.]+ models/)
  const olderSection = text.indexOf('Gemini 2.5 Flash Note', start)
  const previousSection = text.indexOf('Previous models', start)
  const end = olderSection >= 0 ? olderSection : previousSection >= 0 ? previousSection : text.length
  if (start < 0 || end <= start) throw new Error('Gemini model endpoint list not found')
  const section = text.slice(start, end)
  const items = [...section.matchAll(/(Gemini\s+[\d.]+\s+(?:Flash-Lite|Flash|Pro))\s+(gemini-[\d.]+-(?:flash-lite|flash|pro)(?:-preview)?)/gi)]
  if (items.length < 2) throw new Error('Gemini text model endpoint list is incomplete')
  return items.map((match) => ({ id: match[2], name: `${match[1]}${match[2].endsWith('-preview') ? ' Preview' : ''}` }))
}

export function parseGeminiDetail(html, id) {
  const text = plainText(html)
  if (!text.includes(`Model code ${id}`)) throw new Error(`Gemini model page does not confirm ${id}`)
  const limits = text.match(/Input token limit\s*([\d,]+)\s*Output token limit\s*([\d,]+)/i)
  if (!limits) throw new Error(`Gemini token limits not found for ${id}`)
  return { inputContextTokens: tokens(limits[1]), outputContextTokens: tokens(limits[2]) }
}

function currentGeminiPrice(row, now) {
  const prices = [...row.matchAll(/\$([\d.]+)/g)].map((match) => Number(match[1]))
  const futureDate = row.match(/starting ([A-Z][a-z]+ \d{1,2}, \d{4})/)
  return futureDate && now >= new Date(futureDate[1]) && prices.length > 1 ? prices[1] : prices[0]
}

export function parseGeminiPrice(html, id, now) {
  const text = plainText(html)
  const index = text.indexOf(id)
  if (index < 0) throw new Error(`Gemini pricing page does not list ${id}`)
  const slice = text.slice(index, index + 4500)
  const standard = slice.split('Standard')[1]?.split('Batch')[0]
  const inputStart = standard?.indexOf('Input price') ?? -1
  const outputStart = standard?.indexOf('Output price') ?? -1
  const nextStart = standard?.indexOf('Context caching price') ?? -1
  if (inputStart < 0 || outputStart <= inputStart || nextStart <= outputStart) {
    throw new Error(`Gemini Standard pricing rows changed for ${id}`)
  }
  return {
    inputPricePerMillionUsd: currentGeminiPrice(standard.slice(inputStart, outputStart), now),
    outputPricePerMillionUsd: currentGeminiPrice(standard.slice(outputStart, nextStart), now),
  }
}

export function geminiCandidate(item, price, limits, sourceUrl) {
  const note = item.id.includes('-pro-')
    ? '短上下文标准文本价格；超过 20 万 token 的请求、缓存及 Batch 另计。'
    : '标准文本 token 价格；缓存、Batch、其他模态及优惠期限以官方页面为准。'
  return candidate(item.id, item.name, 'Gemini', sourceUrl, note, { ...price, ...limits })
}

export function familyKey(model) {
  if (model.provider === 'OpenAI') return `OpenAI:${model.id.match(/^gpt-[\d.]+-([a-z]+)/)?.[1] ?? model.id}`
  if (model.provider === 'Anthropic') return `Anthropic:${model.id.match(/^claude-([a-z]+)-/)?.[1] ?? model.id}`
  return `Gemini:${model.id.match(/^gemini-[\d.]+-(flash-lite|flash|pro)/)?.[1] ?? model.id}`
}

function version(model) {
  const match = model.provider === 'Anthropic'
    ? model.id.match(/^claude-[a-z]+-(\d+)-(\d+)/)
    : model.id.match(/^(?:gpt|gemini)-([\d.]+)/)
  return (match?.slice(1) ?? []).flatMap((part) => part.split('.').map(Number))
}

function compareVersion(a, b) {
  const left = version(a); const right = version(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0)
  }
  return Number(!a.id.endsWith('-preview')) - Number(!b.id.endsWith('-preview'))
}

export function reconcileProvider(catalog, provider, discovered, checkedAt) {
  const active = [...catalog.models]
  const archived = [...(catalog.archivedModels ?? [])]
  const seen = new Set(discovered.map(({ id }) => id))
  const verified = discovered.filter((item) => item.record).map((item) => item.record)
  const pending = discovered.filter((item) => item.error).map(({ id, name, error }) => ({ id, name, provider, reason: error }))
  for (const record of verified) {
    const priorIndex = active.findIndex((item) => item.id === record.id && item.provider === provider)
    const archiveIndex = archived.findIndex((item) => item.id === record.id && item.provider === provider)
    const prior = priorIndex >= 0 ? active[priorIndex] : archiveIndex >= 0 ? archived[archiveIndex] : undefined
    const updated = { ...prior, ...record, firstSeenAt: prior?.firstSeenAt ?? checkedAt,
      checkedAt, missingChecks: 0 }
    if (priorIndex >= 0) active.splice(priorIndex, 1)
    if (archiveIndex >= 0) archived.splice(archiveIndex, 1)
    active.push(updated)
  }
  const winners = new Map()
  for (const record of verified) {
    const family = familyKey(record)
    if (!winners.has(family) || compareVersion(record, winners.get(family)) > 0) winners.set(family, record)
  }
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const model = active[index]
    if (model.provider !== provider) continue
    const winner = winners.get(familyKey(model))
    const superseded = winner && winner.id !== model.id && compareVersion(winner, model) > 0
    const missingChecks = seen.has(model.id) ? 0 : (model.missingChecks ?? 0) + 1
    if (!superseded && missingChecks < 2) {
      active[index] = { ...model, missingChecks }
      continue
    }
    active.splice(index, 1)
    archived.push({ ...model, missingChecks, archivedAt: model.archivedAt ?? checkedAt,
      archiveReason: superseded ? '被同系列新版取代' : '连续两次未出现在官方当前目录' })
  }
  for (const model of active) {
    if (model.provider === provider) {
      delete model.archivedAt
      delete model.archiveReason
    }
  }
  return { models: active, archivedModels: archived, pendingModels: [
    ...(catalog.pendingModels ?? []).filter((item) => item.provider !== provider), ...pending,
  ] }
}
