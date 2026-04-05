# Crypto Trading Bot

A full-stack automated crypto trading bot with a Python FastAPI backend and a Next.js 14 dashboard. Deploys to **Railway** (backend) and **Vercel** (frontend).

---

## Table of contents

1. [Project structure](#project-structure)
2. [Quick start — local dev](#quick-start--local-dev)
3. [Deploy to production](#deploy-to-production)
4. [Environment variables reference](#environment-variables-reference)
5. [Bot logic explained](#bot-logic-explained)
6. [RSI timeframe — what it means](#rsi-timeframe--what-it-means)
7. [Trading signals](#trading-signals)
8. [Risk management](#risk-management)
9. [Dashboard features](#dashboard-features)
10. [API reference](#api-reference)
11. [How to enable real trading](#how-to-enable-real-trading)
12. [How to cash out](#how-to-cash-out)
13. [Notifications](#notifications)

---

## Project structure

```
crypto-bot/
├── backend/                   # Python FastAPI + trading bot → Railway
│   ├── main.py                # API routes, CORS, lifespan
│   ├── bot.py                 # All trading logic
│   ├── requirements.txt
│   ├── Procfile               # Railway start command
│   ├── railway.json           # Railway build & deploy config
│   ├── nixpacks.toml          # Nixpacks build config (Python 3.11)
│   └── .env.example           # All env vars documented
└── frontend/                  # Next.js 14 App Router → Vercel
    ├── middleware.ts           # JWT auth — protects every route
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── error.tsx           # Error boundary
    │   ├── login/             # Login page
    │   │   └── page.tsx
    │   └── api/auth/          # Login / logout API routes
    │       ├── login/route.ts
    │       └── logout/route.ts
    ├── components/
    │   ├── Dashboard.tsx       # Main layout, polling, flash animations
    │   ├── BotControls.tsx     # Start/Stop, Liquidate, Withdraw, Portfolio
    │   ├── CryptoCard.tsx      # Per-asset card with CTA buttons
    │   ├── PriceChart.tsx      # Recharts price + RSI chart (1D/1W/1M/1Y)
    │   ├── TradeHistory.tsx    # Collapsible trade log with P&L
    │   ├── TradeModal.tsx      # Buy / sell confirmation modal
    │   └── LogoutButton.tsx
    ├── lib/
    │   └── api.ts              # All typed API calls
    └── .env.example
```

---

## Quick start — local dev

### Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env        # fill in your keys (see env vars below)
uvicorn main:app --host 127.0.0.1 --port 8080 --reload
```

API is now running at `http://127.0.0.1:8080`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # fill in values (see env vars below)
npm run dev
```

Dashboard is now at `http://localhost:3000`. You will be prompted to log in.

---

## Deploy to production

### Railway (backend)

1. Connect your GitHub repo → **New Project → Deploy from GitHub**
2. Set **Root Directory** to `backend`
3. Railway auto-detects `railway.json` and uses `nixpacks.toml` to build
4. Add environment variables (see table below)
5. Go to **Settings → Networking → Generate Domain** and set port to **8080**
6. Start command (already in `Procfile`):
   ```
   uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
   ```

### Vercel (frontend)

1. Connect your GitHub repo → **New Project → Import**
2. Set **Root Directory** to `frontend`
3. Framework preset: **Next.js** (auto-detected)
4. Add environment variables (see table below)
5. Deploy — every push to `main` triggers a new deploy automatically

---

## Environment variables reference

### Backend (Railway)

| Variable | Required | Default | Description |
|---|---|---|---|
| `KRAKEN_API_KEY` | Yes (live) | — | Kraken API key |
| `KRAKEN_API_SECRET` | Yes (live) | — | Kraken API secret |
| `SYMBOLS` | No | `BTC/EUR,ETH/EUR,SOL/EUR,XRP/EUR,ADA/EUR,DOT/EUR,LINK/EUR,MATIC/EUR` | Comma-separated trading pairs |
| `TRADE_AMOUNT_EUR` | No | `0` | EUR per auto-buy. **0 = dry-run (no real orders)** |
| `TRAILING_STOP_PCT` | No | `0.03` | Sell when price drops this % from session high (3%) |
| `TAKE_PROFIT_PCT` | No | `0.05` | Sell when price rises this % above entry (5%) |
| `RSI_TIMEFRAME` | No | `1h` | Candle timeframe for RSI/EMA: `1h`, `4h`, or `1d` |
| `RSI_PERIOD` | No | `14` | RSI period |
| `RSI_OVERSOLD` | No | `30` | RSI buy threshold |
| `RSI_OVERBOUGHT` | No | `70` | RSI sell threshold |
| `EMA_FAST` | No | `9` | Fast EMA period |
| `EMA_SLOW` | No | `21` | Slow EMA period |
| `MAX_DAILY_LOSS_EUR` | No | `0` | Pause auto-trading if daily loss exceeds this EUR amount (0 = disabled) |
| `WEBHOOK_URL` | No | — | Discord or Slack webhook URL for trade alerts |

### Frontend (Vercel)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Your Railway backend URL, e.g. `https://your-app.railway.app` |
| `AUTH_PASSWORD` | Yes | Dashboard login password (you choose this) |
| `AUTH_SECRET` | Yes | Random 32+ char string used to sign JWT sessions |

> Generate a secure `AUTH_SECRET` with: `openssl rand -base64 32`

---

## Bot logic explained

The bot runs a background loop **every 10 seconds** per asset. Here is exactly what happens each tick:

```
Fetch live price (Kraken ticker)
    ↓
Update session high (highest price seen since bot started)
    ↓
Every N ticks: refresh OHLCV candles from Kraken → recalculate RSI + EMA
    ↓
Evaluate signals (see Trading signals below)
    ↓
Execute trade if signal fires (or log as dry-run)
    ↓
Sleep 10 seconds → repeat
```

### Two separate price histories

The bot keeps two completely separate data series to avoid timeframe contamination:

| History | Updated | Used for |
|---|---|---|
| **Live price history** | Every 10 s tick | Trailing-stop tracking, session high |
| **OHLCV candle history** | Every candle close (e.g. every hour for `1h`) | RSI and EMA calculations |

This ensures RSI is always computed on consistent candle data — never polluted by 10-second ticks.

---

## RSI timeframe — what it means

The RSI and EMA are computed on **OHLCV candle closes** fetched directly from Kraken, not on the live tick stream. The candle timeframe is controlled by `RSI_TIMEFRAME`:

| `RSI_TIMEFRAME` | RSI(14) looks back | Signal frequency | Best for |
|---|---|---|---|
| `1h` **(default)** | ~14 hours | Higher, more noise | Active intraday trading |
| `4h` | ~2.5 days | Balanced | Swing trading |
| `1d` | ~14 days | Lower, more reliable | Position / long-term trading |

The OHLCV history is refreshed automatically every time one candle closes:
- `1h` → refreshed every 360 bot ticks (360 × 10 s = 1 hour)
- `4h` → refreshed every 1440 bot ticks
- `1d` → refreshed every 8640 bot ticks

**Recommendation:** start with `1h` (default) to get familiar with the signals. Switch to `4h` when you want fewer but more reliable entries.

---

## Trading signals

All three signals must be evaluated together. No single indicator triggers a trade alone.

### BUY signal fires when ALL of:
- RSI < `RSI_OVERSOLD` (30) — asset is oversold
- EMA fast (9) > EMA slow (21) — short-term trend is bullish (upward crossover)
- Previous action was SELL — avoids buying into an already-open position

### SELL signal fires when ANY of:
| Reason | Condition |
|---|---|
| **Trailing stop** | Price dropped ≥ `TRAILING_STOP_PCT` (3%) from session high |
| **Take profit** | Price rose ≥ `TAKE_PROFIT_PCT` (5%) above entry price |
| **RSI overbought** | RSI > `RSI_OVERBOUGHT` (70) |

### HOLD
Neither BUY nor SELL condition is met. No action taken.

---

## Risk management

| Feature | How it works |
|---|---|
| **Dry-run mode** | Default (`TRADE_AMOUNT_EUR=0`). All signals fire and are logged, but no real orders are placed. Safe for testing. |
| **Trailing stop** | Automatically sells if the price pulls back 3% from its peak. Protects profits. |
| **Take profit** | Locks in gains at +5% above your entry price. |
| **Daily loss limit** | If `MAX_DAILY_LOSS_EUR` is set, auto-trading pauses for the rest of the day once the threshold is hit. Resets at midnight. |
| **Manual override** | Buy/Sell buttons on every card let you override the bot at any time. |

---

## Dashboard features

| Feature | Description |
|---|---|
| **Login** | JWT session protected by password. httpOnly cookie, 7-day expiry. |
| **Bot controls** | Start / Stop the trading loop without redeploying. |
| **Portfolio** | Live free/used/total balances fetched from Kraken (requires API keys). |
| **Sell All to EUR** | One-click market-sell of all tracked positions. |
| **Withdraw EUR** | Send EUR to a pre-registered Kraken bank account. |
| **Price chart** | Hidden by default. Click "Show chart" per card. Timeframes: 1D / 1W / 1M / 1Y. |
| **RSI chart** | Displayed below price chart with reference lines at 30 (oversold), 50 (neutral), 70 (overbought). |
| **EMA overlay** | EMA 9 (amber) and EMA 21 (purple) overlaid on price chart. |
| **Trade history** | Collapsible table of all executed trades with side, price, amount, P&L, signal reason. |
| **Price flash** | Card border flashes green on price rise, red on price drop every tick. |
| **Auto-refresh** | Dashboard polls the backend every 3 seconds. |

---

## API reference

### Public endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe — returns `{"healthy": true}` |
| `GET` | `/status` | Live data for all assets (price, RSI, EMA, action, P&L) |
| `GET` | `/config` | Current bot configuration (all env var values) |
| `GET` | `/portfolio` | Kraken balances + daily P&L |
| `GET` | `/trades` | Trade history. Query: `?limit=50` |
| `GET` | `/ohlcv` | Candle data for charts. Query: `?symbol=BTC%2FEUR&timeframe=1h` |

### Bot control

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/bot/status` | Is the bot running? Dry-run? Daily P&L? |
| `POST` | `/bot/start` | Resume the trading loop |
| `POST` | `/bot/stop` | Pause the trading loop (no orders placed while stopped) |
| `POST` | `/bot/liquidate` | Market-sell ALL positions to EUR immediately |

### Trading

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/trade` | `{"symbol":"BTC/EUR","side":"buy","amount_eur":50}` | Manual buy or sell |
| `POST` | `/withdraw` | `{"currency":"EUR","amount":500,"key":"my-bank"}` | Withdraw to Kraken bank account |

---

## How to enable real trading

> **Always test in dry-run mode first.** Set `TRADE_AMOUNT_EUR=0` until you are confident in the signals.

**Step 1 — Create a Kraken API key**

Go to [kraken.com](https://www.kraken.com) → Account → Security → API → Generate Key

Enable only the permissions you need:

| Permission | Required for |
|---|---|
| Query Funds | Portfolio endpoint, balance checks |
| Query Open Orders & Trades | Trade history |
| Create & Modify Orders | Auto-trading, manual Buy/Sell buttons |
| Withdraw Funds | `/withdraw` endpoint only |

**Step 2 — Set Railway env vars**

```
KRAKEN_API_KEY=your_key
KRAKEN_API_SECRET=your_secret
TRADE_AMOUNT_EUR=50        ← EUR to spend per automatic buy
```

**Step 3 — Redeploy Railway** so the new env vars take effect.

**Step 4 — Watch the logs** in Railway → Deployments → View Logs. You will see lines like:

```
BTC/EUR 58500.0000 | action=HOLD rsi=52.3 drop=0.12%
🟢 BUY BTC/EUR | €50.00 @ 58500.0000 | Reason: rsi_oversold+ema_bullish
```

---

## How to cash out

Follow these steps to safely stop the bot and withdraw your funds to your bank:

1. **Stop the bot** — click "Stop Bot" on the dashboard (or `POST /bot/stop`). No more automatic trades will be placed.
2. **Sell all positions** — click "Sell All to EUR" on the dashboard (or `POST /bot/liquidate`). All crypto is sold at market price. Proceeds land in your Kraken EUR balance.
3. **Withdraw EUR** — click "Withdraw EUR" on the dashboard, enter your Kraken bank account name and amount.

> **Before step 3**, you must have a bank account registered in Kraken:
> Kraken → Funding → Withdraw → EUR → Add Withdrawal Address → give it a name.
> That name is what you enter in the "withdrawal key" field.

---

## Notifications

Set `WEBHOOK_URL` on Railway to receive a message every time a trade fires.

Works with **Discord** and **Slack** out of the box:

**Discord:** Server Settings → Integrations → Webhooks → New Webhook → Copy URL

**Slack:** [Create an incoming webhook](https://api.slack.com/messaging/webhooks) → Copy URL

Example notification:
```
🟢 BUY BTC/EUR | €50.00 @ 58432.0000 | Reason: rsi_oversold+ema_bullish
🔴 SELL BTC/EUR | 0.000856 BTC @ 61154.0000 | P&L: +23.17 EUR | Reason: take_profit (5%)
```
