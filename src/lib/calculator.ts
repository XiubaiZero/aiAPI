import type { CostResult, ModelPrice } from '../types'

export function calculateCosts(
  models: ModelPrice[],
  inputTokens: number,
  outputTokens: number,
  apiCalls: number,
  usdToCny: number,
): CostResult[] {
  return models.map((model) => {
    const inputCostUsd = (inputTokens * apiCalls * model.inputPricePerMillionUsd) / 1_000_000
    const outputCostUsd = (outputTokens * apiCalls * model.outputPricePerMillionUsd) / 1_000_000
    const totalCostUsd = inputCostUsd + outputCostUsd
    return {
      model,
      inputCostUsd,
      outputCostUsd,
      totalCostUsd,
      totalCostCny: totalCostUsd * usdToCny,
    }
  })
}

export function isSafeWholeNumber(value: string): boolean {
  if (!/^\d+$/.test(value)) return false
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0
}
