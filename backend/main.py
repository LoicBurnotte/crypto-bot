import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Models ────────────────────────────────────────────────────────────────────

class TradeRequest(BaseModel):
    symbol:         str                     = Field(..., example="BTC/EUR")
    side:           Literal["buy", "sell"]
    amount_eur:     Optional[float]         = Field(None, gt=0, description="EUR to spend (buy only)")
    amount_crypto:  Optional[float]         = Field(None, gt=0, description="Crypto qty to sell (sell only)")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "message": "Crypto Trading Bot API"}


@app.get("/health")
def health():
    return {"healthy": True}


@app.get("/status")
def get_status():
    return {"assets": bot.get_status()}


@app.post("/trade")
def manual_trade(req: TradeRequest):
    """
    Manually trigger a market buy or sell.

    - In dry-run mode (TRADE_AMOUNT_EUR=0) no real order is placed.
    - In live mode the order goes straight to Kraken.
    """
    if req.symbol not in SYMBOLS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown symbol '{req.symbol}'. Tracked symbols: {SYMBOLS}",
        )

    if req.side == "buy":
        result = bot.execute_buy(req.symbol, req.amount_eur)
    else:
        result = bot.execute_sell(req.symbol, req.amount_crypto)

    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Trade failed"))

    return result
