export type Provider = 'OpenAI' | 'Anthropic' | 'Gemini'

export interface ModelPrice {
  id: string
  name: string
  provider: Provider
  inputContextTokens: number
  outputContextTokens: number
  inputPricePerMillionUsd: number
  outputPricePerMillionUsd: number
  sourceUrl: string
  checkedAt: string
  note: string
}

export interface PricingCatalog {
  updatedAt: string
  models: ModelPrice[]
}

export interface ExchangeRate {
  usdToCny: number
  sourceUrl: string
  checkedAt: string
  effectiveDate?: string
  note: string
}

export interface CostResult {
  model: ModelPrice
  inputCostUsd: number
  outputCostUsd: number
  totalCostUsd: number
  totalCostCny: number
}
