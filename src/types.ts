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
  firstSeenAt?: string
  missingChecks?: number
  archivedAt?: string
  archiveReason?: string
}

export interface PricingCatalog {
  updatedAt: string
  models: ModelPrice[]
  archivedModels: ModelPrice[]
  pendingModels: Array<{ id: string; name: string; provider: Provider; reason: string }>
  providerStatus: Partial<Record<Provider, { checkedAt: string | null; lastAttemptAt: string }>>
  issues: Array<{ provider: string; message: string }>
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
