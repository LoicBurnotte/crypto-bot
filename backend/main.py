import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from bot import (
    TradingBot, SYMBOLS,
    TRAILING_STOP_PCT, TAKE_PROFIT_PCT,
    RSI_PERIOD, RSI_OVERSOLD, RSI_OVERBOUGHT, RSI_TIMEFRAME,
    EMA_FAST, EMA_SLOW, TRADE_AMOUNT_EUR, MAX_DAILY_LOSS_EUR,
)

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
    logger.info("Bot loop started")
    yield
    bot.stop()
    if bot_task:
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Crypto Trading Bot", version="2.0.0", lifespan=lifespan)

# ── CORS: belt-and-suspenders ─────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.middleware("http")
async def force_cors(request: Request, call_next):
    if request.method == "OPTIONS":
        res = Response(status_code=204)
        res.headers["Access-Control-Allow-Origin"]  = "*"
        res.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        res.headers["Access-Control-Allow-Headers"] = "*"
        return res
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


# ── Helpers ───────────────────────────────────────────────────────────────────

def live(data) -> JSONResponse:
    res = JSONResponse(data)
    res.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return res


# ── Models ────────────────────────────────────────────────────────────────────

class TradeRequest(BaseModel):
    symbol:        str                    = Field(..., example="BTC/EUR")
    side:          Literal["buy", "sell"]
    amount_eur:    Optional[float]        = Field(None, gt=0)
    amount_crypto: Optional[float]        = Field(None, gt=0)

class WithdrawRequest(BaseModel):
    currency: str   = "EUR"
    amount:   float = Field(..., gt=0)
    key:      str   = Field(..., description="Kraken withdrawal key name")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/health")
def health():
    return {"healthy": True}


@app.get("/status")
def get_status():
    return live({"assets": bot.get_status()})


@app.get("/config")
def get_config():
    return {
        "symbols":           SYMBOLS,
        "trailing_stop_pct": TRAILING_STOP_PCT,
        "take_profit_pct":   TAKE_PROFIT_PCT,
        "rsi_period":        RSI_PERIOD,
        "rsi_timeframe":     RSI_TIMEFRAME,
        "rsi_oversold":      RSI_OVERSOLD,
        "rsi_overbought":    RSI_OVERBOUGHT,
        "ema_fast":          EMA_FAST,
        "ema_slow":          EMA_SLOW,
        "trade_amount_eur":  TRADE_AMOUNT_EUR,
        "max_daily_loss_eur": MAX_DAILY_LOSS_EUR,
        "dry_run":           TRADE_AMOUNT_EUR <= 0,
    }


@app.get("/portfolio")
async def get_portfolio():
    """
    Returns full portfolio snapshot:
    - Each asset: free / used / total quantity + EUR-converted value
    - total_eur: sum of all assets in EUR
    - unrealised_pnl_eur: based on entry prices tracked by the bot
    - daily_pnl: realised P&L for today (from closed trades)
    - all_time_pnl: sum of all pnl_eur entries in the trade log
    """
    try:
        raw = await asyncio.to_thread(bot.exchange.fetch_balance)
        _skip = {"info", "free", "used", "total", "timestamp", "datetime"}

        # Build a price map from bot's live prices + fallback to Kraken
        def eur_price(currency: str) -> Optional[float]:
            if currency in ("EUR", "ZEUR"):
                return 1.0
            symbol = f"{currency}/EUR"
            # Use the live price already tracked by the bot if available
            state = bot.states.get(symbol)
            if state and state.last_price:
                return state.last_price
            # Fallback: fetch from Kraken directly (for assets not in SYMBOLS)
            try:
                return float(bot.exchange.fetch_ticker(symbol)["last"])
            except Exception:
                return None

        balances: dict = {}
        total_eur = 0.0

        for currency, info in raw.items():
            if not isinstance(info, dict) or currency in _skip:
                continue
            total = info.get("total") or 0
            if total <= 0:
                continue

            price = eur_price(currency)
            eur_value = round(total * price, 2) if price is not None else None

            # Entry-price based unrealised P&L for bot-tracked positions
            symbol = f"{currency}/EUR"
            state  = bot.states.get(symbol)
            unreal_pnl_eur = None
            if state and state.entry_price and state.last_price and total > 0:
                unreal_pnl_eur = round((state.last_price - state.entry_price) * info.get("free", 0), 2)

            balances[currency] = {
                "free":            round(info["free"]  or 0, 8),
                "used":            round(info["used"]  or 0, 8),
                "total":           round(total, 8),
                "eur_price":       round(price, 4) if price else None,
                "eur_value":       eur_value,
                "unrealised_pnl_eur": unreal_pnl_eur,
            }
            if eur_value is not None:
                total_eur += eur_value

        all_time_pnl = round(
            sum(t.get("pnl_eur") or 0 for t in bot.trade_log.all()),
            2,
        )

        return live({
            "balances":       balances,
            "total_eur":      round(total_eur, 2),
            "daily_pnl":      round(bot._daily_pnl, 2),
            "all_time_pnl":   all_time_pnl,
            "paused_loss":    bot._paused_loss,
        })
    except Exception as e:
        logger.error("Portfolio fetch failed: %s", e)
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/trades")
def get_trades(limit: int = Query(50, le=500)):
    trades = bot.trade_log.all()[:limit]
    return live({"trades": trades, "total": len(bot.trade_log.all())})


# Allowed OHLCV timeframes and their default candle limits
_TIMEFRAME_LIMITS = {
    "1h":  ("1h",  24),   # 1 day
    "4h":  ("4h",  42),   # 1 week
    "1d":  ("1d",  30),   # 1 month
    "1w":  ("1w",  52),   # 1 year
}

@app.get("/ohlcv")
async def get_ohlcv(
    symbol:    str = Query(..., example="BTC/EUR"),
    timeframe: str = Query("1h", pattern="^(1h|4h|1d|1w)$"),
    limit:     int = Query(0),
):
    if symbol not in SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Unknown symbol '{symbol}'")
    tf, default_limit = _TIMEFRAME_LIMITS[timeframe]
    candles = await asyncio.to_thread(bot.fetch_ohlcv, symbol, tf, limit or default_limit)
    return live({"symbol": symbol, "timeframe": timeframe, "data": candles})


@app.get("/bot/status")
def bot_status():
    return {"running": bot._running, "dry_run": bot.dry_run_mode,
            "daily_pnl": round(bot._daily_pnl, 2), "paused_loss": bot._paused_loss}


@app.post("/bot/symbol/{symbol:path}")
def set_symbol_state(symbol: str, disabled: bool):
    """Enable or disable auto-trading for a single symbol (disabled=true/false)."""
    if symbol not in SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Unknown symbol '{symbol}'")
    bot.states[symbol].disabled = disabled
    logger.info("Symbol %s disabled=%s", symbol, disabled)
    return {"symbol": symbol, "disabled": disabled}


@app.post("/bot/stop")
async def stop_bot():
    global bot_task
    bot.stop()
    if bot_task and not bot_task.done():
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass
    return {"running": False}


@app.post("/bot/start")
async def start_bot():
    global bot_task
    if not bot._running:
        bot_task = asyncio.create_task(bot.run_loop(interval=10))
    return {"running": True}


@app.post("/bot/hold/{symbol:path}")
def set_hold_until_overbought(symbol: str, enabled: bool = True):
    """
    When enabled=true: suspend trailing-stop and take-profit for this asset.
    The bot will only sell once RSI reaches the overbought threshold.
    The flag auto-clears after the sell fires.
    """
    if symbol not in SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Unknown symbol '{symbol}'")
    bot.states[symbol].hold_until_overbought = enabled
    logger.info("hold_until_overbought=%s for %s", enabled, symbol)
    return {"symbol": symbol, "hold_until_overbought": enabled,
            "rsi_target": RSI_OVERBOUGHT}


@app.post("/bot/liquidate")
def liquidate_all():
    results = [{"symbol": s, **bot.execute_sell(s, reason="liquidate")} for s in SYMBOLS]
    return {"results": results}


@app.post("/trade")
def manual_trade(req: TradeRequest):
    if req.symbol not in SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Unknown symbol '{req.symbol}'")
    result = (bot.execute_buy(req.symbol, req.amount_eur, reason="manual")
              if req.side == "buy"
              else bot.execute_sell(req.symbol, req.amount_crypto, reason="manual"))
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@app.post("/withdraw")
def withdraw(req: WithdrawRequest):
    """
    Withdraw to a pre-registered Kraken address.
    Setup: Kraken → Funding → Withdraw → Add Withdrawal Address → give it a name.
    That name is the 'key' field. Requires 'Withdraw Funds' API permission.
    """
    try:
        result = bot.exchange.withdraw(req.currency, req.amount, req.key)
        logger.info("Withdrawal: %.2f %s -> %s", req.amount, req.currency, req.key)
        return {"ok": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
