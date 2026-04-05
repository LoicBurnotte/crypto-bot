import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from bot import TradingBot, SYMBOLS

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

bot = TradingBot()
bot_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_task
    bot_task = asyncio.create_task(bot.run_loop(interval=10))
    logger.info("Bot background loop started")
    yield
    bot.stop()
    if bot_task:
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass
    logger.info("Bot stopped")


app = FastAPI(title="Crypto Trading Bot", version="1.0.0", lifespan=lifespan)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Belt-and-suspenders: CORSMiddleware handles preflight, raw middleware
# stamps every response so Railway's CDN / Envoy never strips the header.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.middleware("http")
async def force_cors(request: Request, call_next):
    """Guarantee Access-Control-Allow-Origin on every response."""
    if request.method == "OPTIONS":
        res = Response(status_code=204)
        res.headers["Access-Control-Allow-Origin"]  = "*"
        res.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        res.headers["Access-Control-Allow-Headers"] = "*"
        return res
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


# ── Models ────────────────────────────────────────────────────────────────────

class TradeRequest(BaseModel):
    symbol:        str                    = Field(..., example="BTC/EUR")
    side:          Literal["buy", "sell"]
    amount_eur:    Optional[float]        = Field(None, gt=0)
    amount_crypto: Optional[float]        = Field(None, gt=0)

class WithdrawRequest(BaseModel):
    currency:     str   = Field("EUR", description="Currency to withdraw")
    amount:       float = Field(..., gt=0)
    key:          str   = Field(..., description="Kraken withdrawal key name (pre-configured in Kraken)")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _no_cache(response: JSONResponse) -> JSONResponse:
    """Prevent Railway CDN from caching live data endpoints."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"]        = "no-cache"
    return response


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "message": "Crypto Trading Bot API"}


@app.get("/health")
def health():
    return {"healthy": True}


@app.get("/status")
def get_status():
    return _no_cache(JSONResponse({"assets": bot.get_status()}))


@app.get("/portfolio")
def get_portfolio():
    """
    Returns free/used/total balances for all non-zero assets.
    Requires KRAKEN_API_KEY with Query Funds permission.
    """
    try:
        raw = bot.exchange.fetch_balance()
        balances = {
            currency: {
                "free":  info["free"],
                "used":  info["used"],
                "total": info["total"],
            }
            for currency, info in raw.items()
            if isinstance(info, dict)
            and currency not in {"info", "free", "used", "total", "timestamp", "datetime"}
            and (info.get("total") or 0) > 0
        }
        return _no_cache(JSONResponse({"balances": balances}))
    except Exception as e:
        logger.error("Portfolio fetch failed: %s", e)
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/bot/status")
def bot_status():
    return {"running": bot._running, "dry_run": bot.dry_run_mode}


@app.post("/bot/stop")
async def stop_bot():
    """Halt the trading loop. No more automatic trades will be placed."""
    global bot_task
    bot.stop()
    if bot_task and not bot_task.done():
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass
    logger.info("Bot manually stopped")
    return {"running": False}


@app.post("/bot/start")
async def start_bot():
    """Resume the trading loop."""
    global bot_task
    if not bot._running:
        bot_task = asyncio.create_task(bot.run_loop(interval=10))
        logger.info("Bot manually started")
    return {"running": True}


@app.post("/bot/liquidate")
async def liquidate_all():
    """
    Sell ALL tracked crypto positions to EUR at market price.
    Useful before withdrawing. Runs even in dry-run mode (simulated).
    """
    results = []
    for symbol in SYMBOLS:
        result = bot.execute_sell(symbol)
        results.append({"symbol": symbol, **result})
    return {"results": results}


@app.post("/trade")
def manual_trade(req: TradeRequest):
    if req.symbol not in SYMBOLS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown symbol '{req.symbol}'. Tracked: {SYMBOLS}",
        )
    if req.side == "buy":
        result = bot.execute_buy(req.symbol, req.amount_eur)
    else:
        result = bot.execute_sell(req.symbol, req.amount_crypto)

    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Trade failed"))
    return result


@app.post("/withdraw")
def withdraw(req: WithdrawRequest):
    """
    Withdraw to a pre-configured Kraken withdrawal address.

    Steps to set up:
    1. kraken.com → Funding → Withdraw → choose currency → Add Withdrawal Address
    2. Give it a name (that name is the 'key' field here)
    3. Call this endpoint with that key name and amount

    Requires KRAKEN_API_KEY with 'Withdraw Funds' permission.
    """
    try:
        result = bot.exchange.withdraw(req.currency, req.amount, req.key)
        logger.info("Withdrawal initiated: %s %s -> %s", req.amount, req.currency, req.key)
        return {"ok": True, "result": result}
    except Exception as e:
        logger.error("Withdrawal failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
