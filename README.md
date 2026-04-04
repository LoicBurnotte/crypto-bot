# Crypto Trading Bot

Full-stack crypto trading bot with a Python FastAPI backend and Next.js 14 frontend.

## Project structure

```
crypto-bot/
├── backend/          # FastAPI + trading bot (deploy to Railway)
│   ├── main.py       # FastAPI app & lifespan
│   ├── bot.py        # Trading logic (trailing stop, RSI, buy placeholder)
│   ├── requirements.txt
│   ├── Procfile
│   └── .env.example
└── frontend/         # Next.js 14 App Router (deploy to Vercel)
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── page.module.css
    │   ├── globals.css
    │   └── error.tsx   ← error boundary
    ├── components/
    │   ├── Dashboard.tsx
    │   ├── Dashboard.module.css
    │   ├── CryptoCard.tsx
    │   └── CryptoCard.module.css
    ├── lib/
    │   └── api.ts
    ├── next.config.js
    ├── package.json
    ├── tsconfig.json
    └── .env.example
```

---

## Backend — Railway

### Local dev

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env   # fill in your Kraken keys
uvicorn main:app --reload --port 8080
```

### Environment variables (Railway)

| Variable            | Description                                                               |
| ------------------- | ------------------------------------------------------------------------- |
| `KRAKEN_API_KEY`    | Kraken API key                                                            |
| `KRAKEN_API_SECRET` | Kraken API secret                                                         |
| `ALLOWED_ORIGINS`   | Comma-separated allowed CORS origins (e.g. `https://your-app.vercel.app`) |
| `PORT`              | Set automatically by Railway                                              |

### Start command

```
uvicorn main:app --host 0.0.0.0 --port $PORT
```

---

## Frontend — Vercel

### Local dev

```bash
cd frontend
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL
npm run dev
```

### Environment variables (Vercel)

| Variable              | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | Your Railway backend URL, e.g. `https://crypto-bot.railway.app` |

---

## Bot logic

- Tracks **highest price** per asset since the bot started.
- **Trailing stop-loss** triggers a SELL signal when price drops ≥ 3 % from the highest.
- **RSI (14)** is computed from live price history; a BUY signal fires when RSI < 30 after a prior SELL.
- Actual order execution is a **placeholder** — search for `PLACEHOLDER` in `bot.py` to wire up real orders.

## API

| Endpoint  | Method | Description                                   |
| --------- | ------ | --------------------------------------------- |
| `/`       | GET    | Health check                                  |
| `/status` | GET    | Live asset data (price, highest, action, RSI) |
| `/health` | GET    | Liveness probe                                |
