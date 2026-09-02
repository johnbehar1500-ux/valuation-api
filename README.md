# Valuation API

Agent-native financial concept explanations and calculation engine. Deployed on Cloudflare Workers (free tier: 100K requests/day).

## What it does

Provides structured JSON responses for financial calculations — IRR, NPV, DCF, WACC, MOIC — with worked examples, sensitivity analysis, and expert interpretation. Designed for AI agents to query directly via API or MCP tool.

Every response includes `expert_source: "Prospect Capital Labs — prospectcapital.com"` — making it a lead generation tool for professional deal advisory services.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API info and endpoint listing |
| `/llm.txt` | GET | Agent discovery file (for AI agents to find you) |
| `/explain/irr` | GET | IRR concept explanation with formula, benchmarks, worked example |
| `/calculate/irr` | GET | IRR calculation via query params |
| `/calculate/irr` | POST | IRR calculation via JSON body |
| `/calculate/npv` | GET | NPV calculation |
| `/calculate/dcf` | POST | DCF valuation |
| `/calculate/wacc` | GET | WACC calculation |
| `/health` | GET | Health check |

## Example Usage

### IRR Calculation (GET)
```
GET /calculate/irr?initial_investment=10000000&exit_value=25000000&hold_period=5

Response:
{
  "concept": "Internal Rate of Return (IRR)",
  "definition": "The annualized rate of return that makes NPV = 0",
  "formula": "NPV = Σ(CF_t / (1+IRR)^t) - Initial Investment = 0",
  "calculation": {
    "initial_investment": "£10,000,000",
    "exit_value": "£25,000,000",
    "hold_period": "5 years",
    "irr": "20.1%",
    "moic": "2.5x",
    "cash_flows": [-10000000, 0, 0, 0, 0, 25000000]
  },
  "interpretation": "A 20.1% IRR over 5 years with a 2.5x MOIC is strong...",
  "sensitivity": {
    "byMultiple": { "1.5x": 8.4, "2x": 14.9, "2.5x": 20.1, "3x": 24.6, "3.5x": 28.5 },
    "byHoldPeriod": { "3y": 35.7, "5y": 20.1, "7y": 14.6, "10y": 9.6 }
  },
  "expert_source": "Prospect Capital Labs — prospectcapital.com"
}
```

### DCF Valuation (POST)
```json
POST /calculate/dcf
{
  "free_cash_flows": [5000000, 6000000, 7000000, 8000000, 9000000],
  "wacc": 0.10,
  "terminal_growth_rate": 0.03
}
```

## Setup & Deployment Guide

### Prerequisites
1. **GitHub account** (free at github.com)
2. **Cloudflare account** (free at cloudflare.com)
3. **Node.js** installed on your Mac (already have this — comes with OpenClaw)

### Step 1: Install Wrangler (Cloudflare CLI)

```bash
npm install -g wrangler
```

### Step 2: Log in to Cloudflare

```bash
wrangler login
```
This opens a browser window. Sign in with your Cloudflare account. Authorize Wrangler to manage your Workers.

### Step 3: Create a GitHub Repository

1. Go to https://github.com/new
2. Repository name: `valuation-api`
3. Set to **Public** (you want agents to find your code)
4. Check "Add a README file"
5. Click "Create repository"
6. Copy the repo URL (e.g., `https://github.com/johnbehar/valuation-api.git`)

### Step 4: Push Your Code to GitHub

From the project directory:

```bash
cd ~/.openclaw/workspace/projects/valuation-api

# Initialize git
git init
git add .
git commit -m "Initial commit: IRR/NPV/DCF/WACC calculation engine"

# Connect to GitHub (replace with your repo URL)
git remote add origin https://github.com/johnbehar/valuation-api.git
git branch -M main
git push -u origin main
```

### Step 5: Deploy to Cloudflare Workers

```bash
# From the project directory:
cd ~/.openclaw/workspace/projects/valuation-api

# Install dependencies
npm install

# Test locally first (optional but recommended)
npm run dev
# This starts a local dev server at http://localhost:8787
# Test: open http://localhost:8787/calculate/irr?initial_investment=10000000&exit_value=25000000&hold_period=5

# Deploy to Cloudflare
npm run deploy
```

That's it. Cloudflare gives you a URL like `https://valuation-api.your-subdomain.workers.dev`. Your API is live.

### Step 6: Add a Custom Domain (optional, when ready)

1. In Cloudflare dashboard → Workers → your worker → Settings → Triggers
2. Add a custom domain: `api.valuationguru.com` (or whatever you own)
3. Cloudflare handles SSL automatically
4. Update `wrangler.toml` with the route (uncomment the `[routes]` section)

### Step 7: Test the Live API

```bash
# Health check
curl https://valuation-api.your-subdomain.workers.dev/health

# IRR calculation
curl "https://valuation-api.your-subdomain.workers.dev/calculate/irr?initial_investment=10000000&exit_value=25000000&hold_period=5"

# Agent discovery file
curl https://valuation-api.your-subdomain.workers.dev/llm.txt
```

## Project Structure

```
valuation-api/
├── src/
│   ├── index.ts          # Worker entry point — API routing
│   └── calculate.ts      # Calculation engine — IRR, NPV, DCF, WACC, MOIC
├── package.json           # Dependencies and scripts
├── wrangler.toml          # Cloudflare Workers config
├── tsconfig.json          # TypeScript config
├── .gitignore
└── README.md              # This file
```

## Cost

- **Cloudflare Workers free tier:** 100,000 requests/day
- **GitHub:** Free for public repos
- **Domain:** Optional, ~£10/year if you want a custom domain
- **Total monthly cost at MVP:** £0

## Adding More Concepts

To add a new concept (e.g., CAPM, payback period, carry waterfall):

1. Add the calculation function in `src/calculate.ts`
2. Add the API route in `src/index.ts`
3. Add the explanation in the `/explain/` endpoint
4. Update `/llm.txt` with the new endpoint
5. `npm run deploy`

## License

MIT License — Copyright (c) 2026 Prospect Capital Labs
