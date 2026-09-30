import { describe, expect, it } from 'vitest'
import {
  discoverOpenAI, discoverAnthropic, discoverGeminiIndex,
  parseGeminiDetail, parseGeminiPrice, reconcileProvider,
} from './catalog-core.mjs'

const date = '2026-09-30T12:00:00+08:00'
const old = { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'OpenAI',
  inputPricePerMillionUsd: 0.2, outputPricePerMillionUsd: 1.2,
  inputContextTokens: 1_050_000, outputContextTokens: 128_000,
  checkedAt: '2026-09-22T04:11:06+08:00', sourceUrl: 'https://developers.openai.com/api/docs/models', note: '' }

describe('official catalog discovery', () => {
  it('discovers new OpenAI model IDs and prices without a hardcoded allowlist', () => {
    const page = 'Flagship models Astra GPT-6 Astra Model ID gpt-6-astra Reasoning high Input price $10 Output price $50 Max output 128K tokens Context window 1.05M Tools New GPT-7 Luna Model ID gpt-7-luna Reasoning medium Input price $0.2 Output price $1 Max output 128K tokens Context window 1.05M Specialized models'
    const entries = discoverOpenAI(page, 'https://developers.openai.com/api/docs/models')
    expect(entries.map((entry) => entry.id)).toEqual(['gpt-6-astra', 'gpt-7-luna'])
    expect(entries[1].record.name).toBe('GPT-7 Luna')
    expect(entries[1].record.outputPricePerMillionUsd).toBe(1)
  })

  it('aligns Anthropic values with the official API ID column after a new model is inserted', () => {
    const page = 'Compare models Feature Claude Fable 5.1 Claude Opus 5.5 Comparative latency Slower Fast Pricing $10 / input MTok $50 / output MTok $4 / input MTok $20 / output MTok Claude API ID claude-fable-5-1 claude-opus-5-5 Capabilities Context window 1M tokens 1M tokens Max output 128K tokens 128K tokens Reliable knowledge cutoff Using the Models API'
    const entries = discoverAnthropic(page, 'https://platform.claude.com/docs/en/models/overview')
    expect(entries.map((entry) => [entry.id, entry.record.inputPricePerMillionUsd])).toEqual([
      ['claude-fable-5-1', 10], ['claude-opus-5-5', 4],
    ])
  })

  it('matches a Gemini endpoint to its detail page and Standard paid price', () => {
    const index = 'All Gemini 3 models Model Endpoint Gemini 3.8 Flash gemini-3.8-flash Gemini 3.5 Flash-Lite gemini-3.5-flash-lite Gemini 2.5 Flash'
    expect(discoverGeminiIndex(index).map((entry) => entry.id)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite'])
    const detail = 'Model code gemini-3.8-flash Token limits Input token limit 1,048,576 Output token limit 65,536'
    expect(parseGeminiDetail(detail, 'gemini-3.8-flash')).toEqual({ inputContextTokens: 1048576, outputContextTokens: 65536 })
    const prices = 'Gemini 3.8 Flash gemini-3.8-flash Standard Paid Tier Input price $0.75 through December 31, 2026. $1.50 starting January 1, 2027. Output price $3.75 through December 31, 2026. $7.50 starting January 1, 2027. Context caching price $0.15 Batch Input price $0.30 Output price $1.50'
    expect(parseGeminiPrice(prices, 'gemini-3.8-flash', new Date('2026-09-30'))).toEqual({ inputPricePerMillionUsd: 0.75, outputPricePerMillionUsd: 3.75 })
    expect(parseGeminiPrice(prices, 'gemini-3.8-flash', new Date('2027-01-02'))).toEqual({ inputPricePerMillionUsd: 1.5, outputPricePerMillionUsd: 7.5 })
  })
})

describe('catalog reconciliation', () => {
  const catalog = { models: [old], archivedModels: [], pendingModels: [] }
  it('updates a name in place and archives a superseded ID', () => {
    const renamed = { ...old, id: 'gpt-6-luna', name: 'GPT-6 Luna', inputPricePerMillionUsd: 0.1 }
    const result = reconcileProvider(catalog, 'OpenAI', [{ id: renamed.id, record: renamed }], date)
    expect(result.models.map((model) => model.id)).toEqual(['gpt-6-luna'])
    expect(result.archivedModels[0].id).toBe('gpt-5.6-luna')
    expect(result.archivedModels[0].checkedAt).toBe(old.checkedAt)
    const sameId = reconcileProvider(result, 'OpenAI', [{ id: renamed.id, record: { ...renamed, name: 'GPT-6 Luna New Name' } }], date)
    expect(sameId.models.find((model) => model.id === renamed.id).name).toBe('GPT-6 Luna New Name')
    expect(sameId.archivedModels).toHaveLength(1)
  })

  it('keeps last verified data when a listed model has no parseable price', () => {
    const result = reconcileProvider(catalog, 'OpenAI', [{ id: old.id, name: old.name, error: 'price missing' }], date)
    expect(result.models[0].checkedAt).toBe(old.checkedAt)
    expect(result.pendingModels[0].id).toBe(old.id)
  })

  it('requires two successful scans before archiving a vanished model', () => {
    const first = reconcileProvider(catalog, 'OpenAI', [{ id: 'gpt-8-astra', record: { ...old, id: 'gpt-8-astra', name: 'GPT-8 Astra' } }], date)
    expect(first.models.some((model) => model.id === old.id)).toBe(true)
    const second = reconcileProvider(first, 'OpenAI', [{ id: 'gpt-8-astra', record: { ...old, id: 'gpt-8-astra', name: 'GPT-8 Astra' } }], date)
    expect(second.models.some((model) => model.id === old.id)).toBe(false)
    expect(second.archivedModels.find((model) => model.id === old.id)?.archiveReason).toContain('连续两次')
  })
})
