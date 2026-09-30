# AI API Price Assistant

A Chinese-language, static web tool for comparing standard text-token API prices and estimating usage costs for OpenAI, Anthropic, and Gemini models.

## Features

- Three pages: current model price comparison, token usage calculator, and historical model archive.
- Text models discovered from three official provider catalogs, with official source links and per-model checked timestamps.
- Cost estimates in USD and approximate CNY.
- Daily official-source verification workflow scheduled for 00:00 China Standard Time.
- No user account, API key, server, or database is required.

## Tech stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org) — UI and type-safe application code
- [Vite](https://vite.dev) — dev server and production build
- [lucide-react](https://lucide.dev) — icons
- [Vitest](https://vitest.dev) — unit tests for cost calculation and input validation
- [GitHub Actions](https://github.com/features/actions) — daily official-price verification workflow
- [Vercel](https://vercel.com) — static hosting

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

`src/data/pricing.json` is the source of truth for UI data. `models` contains the newest verified model in each provider family; `archivedModels` retains older models with their last verified prices and archive dates. `pendingModels` lists newly discovered IDs whose prices or token limits could not be verified. An unchanged official ID with a new display name updates in place. A verified newer ID archives an older version in the same family. An ID missing from the official current catalog is archived only after two successful scans. Archive membership does not imply that the API has stopped accepting that ID.

Only official public OpenAI, Anthropic, and Gemini pages are used. The updater never guesses a new model's price or token limits. Each model has its own `checkedAt`; a failed check keeps the last verified values and does not refresh that timestamp.

The CNY estimate uses the latest available USD/CNY central parity rate published by the People's Bank of China. It is an estimate only and never replaces the official USD API price.

## Daily update workflow

`.github/workflows/daily-price-update.yml` runs at `0 16 * * *` UTC, the beginning of the next day in China Standard Time. It validates the data, checks each provider independently, commits verified values and any issues, then triggers a Vercel deployment through the Git integration. The final health check turns the Actions run red if an official source or new model remains unverified, even though verified updates from other providers have been committed.

## Known limitations

- GitHub Actions scheduled jobs may start later than the configured minute. The UI displays the actual successful verification time.
- Providers can restructure their documentation or introduce a price tier not represented by this calculator. Such models remain pending until the parser can verify a standard text price and token limits; previously verified models and other providers continue updating. If the PBoC source is unavailable, the CNY estimate retains its last verified rate.
- Estimates include only standard text input and output token pricing. Cache reads/writes, Batch, priority/fast tiers, long-context tiers, tools, images, audio, taxes, and negotiated enterprise prices are excluded.
- CNY values use a reference exchange rate and are not a billing quote.

## Deployment

Import this directory into Vercel, select the Vite preset, and use `npm run build` with `dist` as the output directory. `vercel.json` preserves the `/prices` and `/calculator` client-side routes on direct visits. Connect the Vercel project to the GitHub repository so each verified daily data commit redeploys the site.
