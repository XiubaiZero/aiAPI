import { useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, BarChart3, Calculator, CheckCircle2, ChevronRight, ExternalLink, History, Info, Search } from 'lucide-react'
import catalog from './data/pricing.json'
import exchangeRate from './data/exchange-rate.json'
import { calculateCosts, isSafeWholeNumber } from './lib/calculator'
import type { ModelPrice, PricingCatalog, Provider } from './types'

type Page = 'prices' | 'calculator' | 'archive'
type SortKey = 'name' | 'provider' | 'inputContextTokens' | 'outputContextTokens' | 'inputPricePerMillionUsd' | 'outputPricePerMillionUsd'
type SortDirection = 'asc' | 'desc'

const providers: Array<'全部' | Provider> = ['全部', 'OpenAI', 'Anthropic', 'Gemini']
const catalogData = catalog as PricingCatalog
const models = catalogData.models
const archivedModels = catalogData.archivedModels
const formatter = new Intl.NumberFormat('zh-CN')
const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 })
const cnyCurrency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const dataIsStale = (['OpenAI', 'Anthropic', 'Gemini'] as Provider[]).some((provider) => {
  const checkedAt = catalogData.providerStatus?.[provider]?.checkedAt
  return !checkedAt || Date.now() - Date.parse(checkedAt) > 48 * 60 * 60 * 1000
}) || catalogData.issues.length > 0

function getPageFromPath(): Page {
  if (window.location.pathname === '/calculator') return 'calculator'
  if (window.location.pathname === '/archive') return 'archive'
  return 'prices'
}

function formatBeijingDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai', hour12: false,
  }).format(new Date(value))
}

function providerClass(provider: Provider) {
  return `provider provider--${provider.toLowerCase()}`
}

export default function App() {
  const [page, setPage] = useState<Page>(getPageFromPath)
  const [search, setSearch] = useState('')
  const [provider, setProvider] = useState<'全部' | Provider>('全部')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [inputTokens, setInputTokens] = useState('200')
  const [outputTokens, setOutputTokens] = useState('1000')
  const [apiCalls, setApiCalls] = useState('100')
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    const onPopState = () => setPage(getPageFromPath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (nextPage: Page) => {
    const path = `/${nextPage}`
    window.history.pushState({}, '', path)
    setPage(nextPage)
  }

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return [...models]
      .filter((model) => (provider === '全部' || model.provider === provider) &&
        (model.name.toLowerCase().includes(normalizedSearch) || model.provider.toLowerCase().includes(normalizedSearch)))
      .sort((a, b) => {
        const aValue = a[sortKey]
        const bValue = b[sortKey]
        const comparison = typeof aValue === 'string'
          ? aValue.localeCompare(bValue as string)
          : Number(aValue) - Number(bValue)
        return sortDirection === 'asc' ? comparison : -comparison
      })
  }, [provider, search, sortDirection, sortKey])

  const archiveRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return archivedModels.filter((model) => (provider === '全部' || model.provider === provider) &&
      (model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query) || model.provider.toLowerCase().includes(query)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [provider, search])

  const results = useMemo(() => {
    if (!submitted || formError) return []
    return calculateCosts(models, Number(inputTokens), Number(outputTokens), Number(apiCalls), exchangeRate.usdToCny)
      .sort((a, b) => a.totalCostUsd - b.totalCostUsd)
  }, [apiCalls, formError, inputTokens, outputTokens, submitted])

  const requestSort = (key: SortKey) => {
    if (key === sortKey) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  const handleCalculate = () => {
    const values = [inputTokens, outputTokens, apiCalls]
    if (!values.every(isSafeWholeNumber)) {
      setFormError('请输入不小于 0 的整数 token 数量与调用次数。')
      setSubmitted(false)
      return
    }
    setFormError('')
    setSubmitted(true)
  }

  const changeInput = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    if (submitted) setSubmitted(false)
    if (formError) setFormError('')
  }

  return (
    <main>
      <section className="hero shell">
        <div className="brand"><BarChart3 aria-hidden="true" size={25} strokeWidth={2.8} /><span>AI API 价格助手</span></div>
        <div className="eyebrow">{dataIsStale ? <Info aria-hidden="true" size={16} /> : <CheckCircle2 aria-hidden="true" size={16} />}{dataIsStale ? '部分官方数据待核验' : '每日核验官方定价'}</div>
        <h1>海外 AI API<br className="mobile-break" /> 价格比较与用量估算</h1>
        <p>集中比较 OpenAI、Anthropic 与 Gemini 的标准文本 token 定价。</p>
        <div className="page-tabs" aria-label="页面导航">
          <button className={page === 'prices' ? 'tab active' : 'tab'} onClick={() => navigate('prices')}><BarChart3 size={17} />模型价格对比</button>
          <button className={page === 'calculator' ? 'tab active' : 'tab'} onClick={() => navigate('calculator')}><Calculator size={17} />用量统计</button>
          <button className={page === 'archive' ? 'tab active' : 'tab'} onClick={() => navigate('archive')}><History size={17} />历史模型</button>
        </div>
      </section>

      <section className="shell content">
        {page === 'prices' ? (
          <PriceComparison
            search={search} provider={provider} rows={rows} sortKey={sortKey} sortDirection={sortDirection}
            onSearch={setSearch} onProvider={setProvider} onSort={requestSort}
          />
        ) : page === 'calculator' ? (
          <UsageCalculator
            inputTokens={inputTokens} outputTokens={outputTokens} apiCalls={apiCalls} formError={formError} submitted={submitted} results={results}
            onInputTokens={changeInput(setInputTokens)} onOutputTokens={changeInput(setOutputTokens)} onApiCalls={changeInput(setApiCalls)} onCalculate={handleCalculate}
          />
        ) : (
          <ArchivePage search={search} provider={provider} rows={archiveRows}
            onSearch={setSearch} onProvider={setProvider} />
        )}
      </section>

      <footer className="shell footer">
        <div><strong>最近核验：</strong>{formatBeijingDate(catalog.updatedAt)}（北京时间）</div>
        {dataIsStale && <div>部分来源未完成核验，请查看模型对应的核验时间与官方链接。</div>}
        <div>仅用于标准文本 token 成本估算，不构成报价。</div>
      </footer>
    </main>
  )
}

function PriceComparison({ search, provider, rows, sortKey, sortDirection, onSearch, onProvider, onSort }: {
  search: string; provider: '全部' | Provider; rows: ModelPrice[]; sortKey: SortKey; sortDirection: SortDirection
  onSearch: (value: string) => void; onProvider: (value: '全部' | Provider) => void; onSort: (key: SortKey) => void
}) {
  const columns: Array<{ key: SortKey; label: string }> = [
    { key: 'name', label: '模型名称' }, { key: 'provider', label: '供应商' }, { key: 'inputContextTokens', label: '输入长度' },
    { key: 'outputContextTokens', label: '输出长度' }, { key: 'inputPricePerMillionUsd', label: '输入价格' }, { key: 'outputPricePerMillionUsd', label: '输出价格' },
  ]

  return <>
    <div className="section-heading">
      <div><span className="section-kicker">模型价格对比</span><h2>选择适合预算的模型</h2></div>
      <p>共 {rows.length} 个模型 · 单价单位：USD / 100 万 tokens</p>
    </div>
    <div className="filter-row">
      <label className="search-box"><Search size={20} /><span className="sr-only">搜索模型</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索模型或供应商…" /></label>
      <div className="provider-filters" aria-label="供应商筛选">
        {providers.map((item) => <button key={item} onClick={() => onProvider(item)} className={provider === item ? 'filter active' : 'filter'}>{item}</button>)}
      </div>
    </div>
    <div className="table-card">
      <div className="table-scroll">
        <table>
          <thead><tr>{columns.map((column) => <th key={column.key}><button onClick={() => onSort(column.key)}>{column.label}<ArrowUpDown size={14} className={sortKey === column.key ? 'sorted' : ''} /><span className="sr-only">{sortKey === column.key ? (sortDirection === 'asc' ? '升序' : '降序') : ''}</span></button></th>)}</tr></thead>
          <tbody>{rows.map((model) => <tr key={model.id}>
            <td className="model-name">{model.name}</td>
            <td><span className={providerClass(model.provider)}>{model.provider}</span></td>
            <td>{formatter.format(model.inputContextTokens)}</td>
            <td>{formatter.format(model.outputContextTokens)}</td>
            <td>{currency.format(model.inputPricePerMillionUsd)}</td>
            <td>{currency.format(model.outputPricePerMillionUsd)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="empty">没有匹配的模型，请尝试调整搜索关键词或供应商筛选。</div>}
    </div>
    <SourcePanel />
  </>
}

function ArchivePage({ search, provider, rows, onSearch, onProvider }: {
  search: string; provider: '全部' | Provider; rows: ModelPrice[]
  onSearch: (value: string) => void; onProvider: (value: '全部' | Provider) => void
}) {
  return <>
    <div className="section-heading">
      <div><span className="section-kicker">历史模型</span><h2>保留过去核验过的型号</h2></div>
      <p>共 {rows.length} 条归档记录 · 价格为最后一次核验值</p>
    </div>
    <p className="archive-intro">归档表示型号已退出首页比较，不一定意味着 API 已停用。历史价格仅供回看；实际调用前请查看官方来源。</p>
    <div className="filter-row">
      <label className="search-box"><Search size={20} /><span className="sr-only">搜索历史模型</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索历史模型或 ID…" /></label>
      <div className="provider-filters" aria-label="历史模型供应商筛选">
        {providers.map((item) => <button key={item} onClick={() => onProvider(item)} className={provider === item ? 'filter active' : 'filter'}>{item}</button>)}
      </div>
    </div>
    <div className="table-card"><div className="table-scroll"><table>
      <thead><tr><th>模型名称 / ID</th><th>供应商</th><th>最后核验输入价</th><th>最后核验输出价</th><th>最后核验时间</th><th>归档原因</th><th>来源</th></tr></thead>
      <tbody>{rows.map((model) => <tr key={`${model.provider}:${model.id}`}>
        <td className="model-name">{model.name}<small className="model-id">{model.id}</small></td>
        <td><span className={providerClass(model.provider)}>{model.provider}</span></td>
        <td>{currency.format(model.inputPricePerMillionUsd)}</td>
        <td>{currency.format(model.outputPricePerMillionUsd)}</td>
        <td>{formatBeijingDate(model.checkedAt)}</td>
        <td><span className="archive-status">{model.archiveReason ?? '已退出当前目录'}</span></td>
        <td><a href={model.sourceUrl} target="_blank" rel="noreferrer">官方页面 <ExternalLink size={13} /></a></td>
      </tr>)}</tbody>
    </table></div>{rows.length === 0 && <div className="empty">没有匹配的历史模型。</div>}</div>
  </>
}

function UsageCalculator({ inputTokens, outputTokens, apiCalls, formError, submitted, results, onInputTokens, onOutputTokens, onApiCalls, onCalculate }: {
  inputTokens: string; outputTokens: string; apiCalls: string; formError: string; submitted: boolean
  results: ReturnType<typeof calculateCosts>; onInputTokens: (value: string) => void; onOutputTokens: (value: string) => void; onApiCalls: (value: string) => void; onCalculate: () => void
}) {
  const exampleModel = models.find((model) => model.provider === 'OpenAI') ?? models[0]
  const [example] = exampleModel ? calculateCosts([exampleModel], 200, 1000, 100, exchangeRate.usdToCny) : []

  return <>
    <div className="section-heading">
      <div><span className="section-kicker">用量统计</span><h2>按 token 预估 API 成本</h2></div>
      <p>基于 {models.length} 个现行模型的标准按量付费价格</p>
    </div>
    <section className="calculator-card" aria-labelledby="calculator-title">
      <h3 id="calculator-title">输入你的预计用量</h3>
      <div className="input-grid">
        <NumberInput label="输入 token 数量" value={inputTokens} onChange={onInputTokens} hint="单次请求的平均输入量" />
        <NumberInput label="输出 token 数量" value={outputTokens} onChange={onOutputTokens} hint="单次请求的平均输出量" />
        <NumberInput label="API 调用次数" value={apiCalls} onChange={onApiCalls} hint="预计总调用次数" />
      </div>
      <div className="calculation-mode"><span>计算方式</span><strong>Token</strong><span className="mode-note">首版仅支持 token 计算</span></div>
      {formError && <p role="alert" className="form-error">{formError}</p>}
      <button className="calculate-button" onClick={onCalculate}><Calculator size={18} />开始计算<ChevronRight size={17} /></button>
    </section>
    <section className="formula-guide" aria-labelledby="formula-title">
      <div>
        <span className="section-kicker">如何计算</span>
        <h3 id="formula-title">成本公式与示例</h3>
        <p>“输入 token 数量”和“输出 token 数量”均表示<strong>单次 API 调用的平均 token 数</strong>；系统会先乘以 API 调用次数，再按对应模型每 100 万 tokens 的官方单价计算。</p>
      </div>
      <div className="formula-grid">
        <div className="formula-item"><span>输入成本</span><code>输入 tokens × 调用次数 ÷ 1,000,000 × 输入单价</code></div>
        <div className="formula-item"><span>输出成本</span><code>输出 tokens × 调用次数 ÷ 1,000,000 × 输出单价</code></div>
        <div className="formula-item"><span>总成本</span><code>输入成本 + 输出成本</code></div>
      </div>
      {exampleModel && example && <div className="formula-example">
        <strong>示例：{exampleModel.name}</strong>
        <p>输入 200 tokens、输出 1,000 tokens、调用 100 次；输入单价 {currency.format(exampleModel.inputPricePerMillionUsd)} / 百万 tokens，输出单价 {currency.format(exampleModel.outputPricePerMillionUsd)} / 百万 tokens。</p>
        <p><code>输入：200 × 100 ÷ 1,000,000 × {currency.format(exampleModel.inputPricePerMillionUsd)} = {currency.format(example.inputCostUsd)}</code></p>
        <p><code>输出：1,000 × 100 ÷ 1,000,000 × {currency.format(exampleModel.outputPricePerMillionUsd)} = {currency.format(example.outputCostUsd)}</code></p>
        <p className="example-total">合计：<strong>{currency.format(example.totalCostUsd)}</strong> <span>≈ {cnyCurrency.format(example.totalCostCny)}</span></p>
      </div>}
    </section>
    {submitted && <section className="results" aria-live="polite">
      <div className="results-title"><div><span className="section-kicker">计算结果</span><h2>各模型总成本</h2></div><p>按总成本由低到高排序</p></div>
      <div className="result-list">{results.map((result, index) => <article className="result-row" key={result.model.id}>
        <div className="rank">{index + 1}</div>
        <div className="result-model"><strong>{result.model.name}</strong><span className={providerClass(result.model.provider)}>{result.model.provider}</span></div>
        <div><span>输入成本</span><strong>{currency.format(result.inputCostUsd)}</strong></div>
        <div><span>输出成本</span><strong>{currency.format(result.outputCostUsd)}</strong></div>
        <div className="total"><span>预计总成本</span><strong>{currency.format(result.totalCostUsd)}</strong><em>≈ {cnyCurrency.format(result.totalCostCny)}</em></div>
      </article>)}</div>
      <p className="exchange-note">人民币换算采用中国人民银行最近可用美元兑人民币中间价（1 USD ≈ {exchangeRate.usdToCny} CNY，汇率日期 {exchangeRate.effectiveDate ?? formatBeijingDate(exchangeRate.checkedAt).slice(0, 10)}），仅供估算。</p>
    </section>}
    {!submitted && <div className="results-placeholder"><Info size={20} />填写三个数值后，点击“开始计算”查看各模型的成本结果。</div>}
  </>
}

function NumberInput({ label, value, hint, onChange }: { label: string; value: string; hint: string; onChange: (value: string) => void }) {
  return <label className="number-input"><span>{label}</span><input inputMode="numeric" pattern="[0-9]*" value={value} onChange={(event) => onChange(event.target.value)} /><small>{hint}</small></label>
}

function SourcePanel() {
  return <details className="source-panel">
    <summary><Info size={17} />数据来源与查询日期</summary>
    <p>价格仅来自供应商官方页面；表格显示标准文本 token 单价。</p>
    <div className="source-grid">{models.map((model) => <a key={model.id} href={model.sourceUrl} target="_blank" rel="noreferrer"><div><strong>{model.name}</strong><span>{formatBeijingDate(model.checkedAt)}</span></div><ExternalLink size={16} /></a>)}</div>
  </details>
}
