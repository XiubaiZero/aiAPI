import { describe, expect, it } from 'vitest'
import { calculateCosts, isSafeWholeNumber } from './calculator'
import type { ModelPrice } from '../types'

const model: ModelPrice = {
  id: 'test-model', name: '测试模型', provider: 'OpenAI', inputContextTokens: 1000,
  outputContextTokens: 1000, inputPricePerMillionUsd: 2, outputPricePerMillionUsd: 10,
  sourceUrl: 'https://example.com', checkedAt: '2026-09-17T00:00:00+08:00', note: '',
}

describe('calculateCosts', () => {
  it('calculates standard input and output token costs', () => {
    const [result] = calculateCosts([model], 200, 1000, 100, 7.1)
    expect(result.inputCostUsd).toBeCloseTo(0.04)
    expect(result.outputCostUsd).toBeCloseTo(1)
    expect(result.totalCostUsd).toBeCloseTo(1.04)
    expect(result.totalCostCny).toBeCloseTo(7.384)
  })

  it('only accepts safe whole-number input', () => {
    expect(isSafeWholeNumber('0')).toBe(true)
    expect(isSafeWholeNumber('200')).toBe(true)
    expect(isSafeWholeNumber('-1')).toBe(false)
    expect(isSafeWholeNumber('1.5')).toBe(false)
    expect(isSafeWholeNumber('')).toBe(false)
  })
})
