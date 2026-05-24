# Validator Transparency Dashboard

A delegator-focused **comparison navigator** for Solana validators. Open any mainnet vote account, see how it stacks up on stability history, commission risk, live voting behavior, reward estimates, and stake-pool presence – with plain-English copy and tooltips throughout.

**Live:** [validator-transparency-dashboard.vercel.app](https://validator-transparency-dashboard.vercel.app)

---

## What it does

The dashboard helps you **compare validators side by side** using public on-chain and third-party feeds – not as staking advice, but as structured context before you delegate.

### Home & directory

- **Validator directory** on the landing page – search by name or vote key (Stakewiz catalog)
- Avatars with initials fallback, commission, stake, Jito-capable flag, and vote-success % in the table
- No default validator loaded – paste a vote account or pick from search / typeahead
- **Reading guide** (collapsible) for new users

### Validator profile

- **At a glance** KPI strip – stability, commission, status, recent voting, Jito, APY estimate, pool count
- **Network-relative read** – color band (lime / mint / gray / yellow / orange) from snapshot depth + tracked metrics vs network medians
- **Signal breakdown** – positives and cautions rolled up from the same telemetry (separate from the network read band)
- **Trust card** – commission, live RPC status, recent voting % (finished epochs only; in-progress epoch excluded from chart)
- **All-time stability score** – primary ring from full stored snapshot history (delinquency share + commission-change history)
- **Estimated rewards & pools** – blended APY (Stakewiz + Trillium), stake split by pool vs non-pool (**Trillium API**), pool badges
- **Recent voting chart** – consistency % per finished epoch
- **Compare mode** – A vs B on the same page; share URL preserves `vote` and optional `vote2`
- Light / dark theme (persisted)

### Backend & data pipeline

- **Daily cron** snapshots **all** mainnet vote accounts from RPC → Supabase (not only opened profiles)
- Server-side RPC proxy (no client API keys)
- Optional `track-validator` ping on page open (analytics / interest only)
- Network-wide medians for commission, APY, and stake context

---

## Data sources

| Signal | Source |
|--------|--------|
| Live status, commission, epoch credits | Solana RPC (server proxy: `api/rpc.js`) |
| Validator names, directory, catalog APY | [Stakewiz API](https://stakewiz.com) |
| Pool stake split, Trillium APY | [Trillium API](https://trillium.so) |
| Jito ON/OFF | Jito public feed (proxied) |
| Stability history | Supabase (`validator_snapshots`) |
| Network medians | Stakewiz full catalog (`api/network-stats.js`) |

APY figures are **estimates** for comparison – not payout quotes.

---

## Project structure

```
├── index.html          # Single-page UI (landing + profile + compare)
├── app.js              # Frontend logic (live data, charts, verdict, compare)
├── validators.html     # Redirects to home #directory-section
├── api/
│   ├── collect.js      # Cron: snapshot all vote accounts → Supabase
│   ├── snapshots.js    # Read snapshot history for a vote account
│   ├── ratings.js      # Stakewiz + Trillium APY / pool merge
│   ├── network-stats.js# Network medians for context lines
│   ├── validators-directory.js  # Searchable Stakewiz catalog
│   ├── rpc.js          # Server-side RPC proxy
│   ├── jito.js         # Jito status proxy
│   ├── track-validator.js       # Optional interest ping
│   └── env-check.js    # Safe env diagnostics for deploy health
├── assets/             # Logo and static images
├── vercel.json         # Cron schedule + API CORS headers
└── env.example         # Required environment variables
```

---

## Quick start (local)

### Frontend only

```bash
# Any static server, e.g.:
npx serve .
# Open http://localhost:3000
```

Live APIs default to the production Vercel backend when served from GitHub Pages. For full local backend, deploy API routes or point `API_BASE` in `app.js` at your Vercel preview URL.

### Full stack (Vercel + Supabase)

1. Copy `env.example` → `.env` (local) or set variables in Vercel project settings.
2. Install dependencies: `npm install`
3. Deploy to Vercel (or `vercel dev` for local API routes).

### Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | collect, snapshots, track-validator | Database |
| `SUPABASE_SERVICE_ROLE_KEY` | collect, snapshots, track-validator | Database write/read |
| `HELIUS_API_KEY` | collect | Preferred RPC for daily collection |
| `SOLANA_RPC` | rpc.js | Live vote-account reads |
| `CRON_SECRET` | collect | Auth header for scheduled collection |

---

## HTTP API (builder surface)

All routes live under `/api/` on the deployed origin.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/snapshots?vote=` | GET | Snapshot window + all-time stats for a vote account |
| `/api/ratings?vote=` | GET | Stakewiz + Trillium APY and pool stake split |
| `/api/network-stats` | GET | Network-wide commission / APY / stake summaries |
| `/api/validators-directory?q=&limit=` | GET | Search Stakewiz catalog |
| `/api/rpc` | POST | Proxied Solana JSON-RPC |
| `/api/jito?vote=` | GET | Jito status for a vote account |
| `/api/track-validator` | POST | Record page-open interest (optional) |
| `/api/collect` | POST | Cron-triggered full-network snapshot job |
| `/api/env-check` | GET | Non-secret env configuration check |

CORS is enabled for browser use from static hosting.

---

## URL parameters

| Param | Example | Effect |
|-------|---------|--------|
| `vote` | `?vote=3QPGL…` | Open validator profile |
| `vote2` | `?vote=…&vote2=…` | Open with compare panel |
| `name` | `?vote=…&name=MyValidator` | Optional display name override |

Share link on the profile page copies the current URL including compare state.

---

## How to read the page (short)

1. Start with **Stability score** (all-time snapshot history).
2. Check **Commission** and live **Status** for hard risk flags.
3. Use **Network-relative read** and **Signal breakdown** as comparison summaries – not buy/skip advice.
4. Use **APY** and **pool presence** as reward context (estimates only).
5. Confirm recent behavior with the **voting chart**; prefer stability over a few epochs if they disagree.

---

## Roadmap

**Done**

- All-time snapshot-based stability scoring
- Validator comparison on the same page
- Full-network snapshot collection (daily cron; all RPC vote accounts)
- Home directory with search, avatars, and richer pickers
- At-a-glance KPI strip and beginner-friendly reading guide
- Trillium-sourced stake pool split with clear source attribution

**Next**

- Per-epoch detail page
- Delinquency alerts and proactive signals
- Actionable insight layer – exports and “what changed” summaries
- Builder-ready surface – documented metric definitions and embed patterns

---

## Deploy notes

- **Vercel Hobby:** cron runs once daily (`0 0 * * *` in `vercel.json`).
- **GitHub Pages:** frontend only; set production API base in `app.js` (`API_BASE`).
- RPC keys stay server-side – never commit `.env`.

---

## Author

Built by **AndrewInUA** – an open tool for any Solana validator.

Questions and contributions: [GitHub Issues](https://github.com/AndrewInUA/validator-transparency-dashboard/issues)
