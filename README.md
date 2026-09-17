# AI API Price Assistant

A Chinese-language, static web tool for comparing standard text-token API prices and estimating usage costs for OpenAI, Anthropic, and Gemini models.

## Features

- Two pages: model price comparison and token usage calculator.
- Nine text models from three providers, with official source links and checked timestamps.
- Cost estimates in USD and approximate CNY.
- Daily official-source verification workflow scheduled for 00:00 China Standard Time.
- No user account, API key, server, or database is required.

## Local development

```bash
npm install
npm run dev
```

Run the checks and production build:

```bash
npm test
npm run build
```

## Data policy

`src/data/pricing.json` is the source of truth for UI data. Every record has an official provider URL and a Beijing-time `checkedAt` field. The updater only accepts prices parsed from the official OpenAI, Anthropic, and Gemini pages; it deliberately fails instead of using an aggregator or an inferred price.

The CNY estimate uses the latest available USD/CNY central parity rate published by the People's Bank of China. It is an estimate only and never replaces the official USD API price.

## Daily update workflow

`.github/workflows/daily-price-update.yml` runs at `0 16 * * *` UTC, the beginning of the next day in China Standard Time. It validates the data, fetches official pages, updates timestamps and verified values, commits the dataset, and triggers a Vercel deployment through the Git integration.

## Known limitations

- GitHub Actions scheduled jobs may start later than the configured minute. The UI displays the actual successful verification time.
- Providers can restructure their documentation. The updater is intentionally conservative: if parsing fails, it does not overwrite the previously verified dataset.
- Estimates include only standard text input and output token pricing. Cache reads/writes, Batch, priority/fast tiers, long-context tiers, tools, images, audio, taxes, and negotiated enterprise prices are excluded.
- CNY values use a reference exchange rate and are not a billing quote.

## Deployment

Import this directory into Vercel, select the Vite preset, and use `npm run build` with `dist` as the output directory. `vercel.json` preserves the `/prices` and `/calculator` client-side routes on direct visits. Connect the Vercel project to the GitHub repository so each verified daily data commit redeploys the site.
