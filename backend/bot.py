import asyncio
import logging
import os
from datetime import datetime
from typing import Optional

import ccxt

logger = logging.getLogger(__name__)

# ── Config (all overridable via env vars) ─────────────────────────────────────
_raw_symbols = os.getenv(
    "SYMBOLS",
    "BTC/EUR,ETH/EUR,SOL/EUR,XRP/EUR,ADA/EUR,DOT/EUR,LINK/EUR",
)
SYMBOLS = [s.strip() for s in _raw_symbols.split(",") if s.strip()]

TRAILING_STOP_PCT = float(os.getenv("TRAILING_STOP_PCT", "0.03"))   # 3 %
RSI_PERIOD        = int(os.getenv("RSI_PERIOD", "14"))
RSI_OVERSOLD      = float(os.getenv("RSI_OVERSOLD", "30"))
RSI_OVERBOUGHT    = float(os.getenv("RSI_OVERBOUGHT", "70"))
EMA_FAST          = int(os.getenv("EMA_FAST", "9"))
EMA_SLOW          = int(os.getenv("EMA_SLOW", "21"))

# Set > 0 to enable real orders; 0 = dry-run (log only, no orders placed)
TRADE_AMOUNT_EUR  = float(os.getenv("TRADE_AMOUNT_EUR", "0"))


# ── Indicators ────────────────────────────────────────────────────────────────

def compute_rsi(prices: list[float], period: int = RSI_PERIOD) -> Optional[float]:
    """Wilder's smoothed RSI — more accurate than simple-average RSI."""
    if len(prices) < period + 1:
        return None

    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]

    gains  = [max(d, 0.0) for d in deltas[:period]]
    losses = [abs(min(d, 0.0)) for d in deltas[:period]]
    avg_gain = sum(gains)  / period
    avg_loss = sum(losses) / period

    for delta in deltas[period:]:
        avg_gain = (avg_gain * (period - 1) + max(delta, 0.0))       / period
        avg_loss = (avg_loss * (period - 1) + abs(min(delta, 0.0))) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def compute_ema(prices: list[float], period: int) -> Optional[float]:
    """Exponential moving average."""
    if len(prices) < period:
        return None
    k   = 2.0 / (period + 1)
    ema = sum(prices[:period]) / period
    for p in prices[period:]:
        ema = p * k + ema * (1 - k)
    return ema


# ── State ─────────────────────────────────────────────────────────────────────

class AssetState:
    def __init__(self, symbol: str):
        self.symbol       = symbol
        self.last_price:  Optional[float] = None
        self.highest:     Optional[float] = None
        self.last_action: str             = "HOLD"
        self.rsi:         Optional[float] = None
        self.ema_fast:    Optional[float] = None
        self.ema_slow:    Optional[float] = None
        self.last_updated: Optional[str]  = None
        self.error:        Optional[str]  = None

    def to_dict(self) -> dict:
        drop_pct = None
        if self.highest and self.last_price:
            drop_pct = round((self.highest - self.last_price) / self.highest * 100, 2)
        return {
            "symbol":       self.symbol,
            "last_price":   self.last_price,
            "highest":      self.highest,
            "last_action":  self.last_action,
            "rsi":          round(self.rsi, 2)      if self.rsi      is not None else None,
            "ema_fast":     round(self.ema_fast, 4) if self.ema_fast is not None else None,
            "ema_slow":     round(self.ema_slow, 4) if self.ema_slow is not None else None,
            "drop_pct":     drop_pct,
            "dry_run":      TRADE_AMOUNT_EUR <= 0,
            "last_updated": self.last_updated,
            "error":        self.error,
        }


# ── Bot ───────────────────────────────────────────────────────────────────────

class TradingBot:
    def __init__(self):
        self.exchange = ccxt.kraken({
            "apiKey":          os.getenv("KRAKEN_API_KEY", ""),
            "secret":          os.getenv("KRAKEN_API_SECRET", ""),
            "enableRateLimit": True,
        })
        self.states:         dict[str, AssetState]    = {s: AssetState(s) for s in SYMBOLS}
        self._price_history: dict[str, list[float]]   = {s: []            for s in SYMBOLS}
        self._running = False

    # ── Exchange helpers ──────────────────────────────────────────────────────

    def _fetch_ticker(self, symbol: str) -> Optional[float]:
        try:
            return float(self.exchange.fetch_ticker(symbol)["last"])
        except ccxt.NetworkError  as e: logger.warning("Network error   %s: %s", symbol, e)
        except ccxt.ExchangeError as e: logger.warning("Exchange error  %s: %s", symbol, e)
        except Exception          as e: logger.error(  "Unexpected error %s: %s", symbol, e)
        return None

    def _seed_history(self, symbol: str):
        """Seed price history from OHLCV so indicators are ready immediately."""
        try:
            ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe="1h", limit=100)
            closes = [c[4] for c in ohlcv]
            self._price_history[symbol] = closes
            logger.info("Seeded %d candles for %s", len(closes), symbol)
        except Exception as e:
            logger.warning("Could not seed OHLCV for %s: %s", symbol, e)

    def _get_balance(self, currency: str) -> float:
        """Fetch free balance for a currency (e.g. 'EUR', 'BTC')."""
        try:
            bal = self.exchange.fetch_balance()
            return float(bal.get(currency, {}).get("free", 0.0))
        except Exception as e:
            logger.warning("Balance fetch failed for %s: %s", currency, e)
            return 0.0

    # ── Order execution ───────────────────────────────────────────────────────

    def execute_buy(self, symbol: str, amount_eur: Optional[float] = None) -> dict:
        """
        Place a market BUY order.
        amount_eur defaults to TRADE_AMOUNT_EUR env var.
        Returns a result dict with success/error info.
        """
        eur = amount_eur if amount_eur and amount_eur > 0 else TRADE_AMOUNT_EUR
        price = self.states[symbol].last_price

        if not price:
            return {"ok": False, "error": "No price available"}

        if eur <= 0:
            logger.info("[DRY RUN] Would BUY %.2f EUR of %s at %.4f", eur or 0, symbol, price)
            return {"ok": True, "dry_run": True, "symbol": symbol, "amount_eur": eur}

        amount_crypto = eur / price
        try:
            order = self.exchange.create_order(symbol, "market", "buy", amount_crypto)
            logger.info("BUY order placed for %s: %s", symbol, order.get("id"))
            self.states[symbol].last_action = "BUY"
            return {"ok": True, "dry_run": False, "order_id": order.get("id"), "symbol": symbol}
        except ccxt.InsufficientFunds:
            return {"ok": False, "error": "Insufficient EUR balance"}
        except Exception as e:
            logger.error("BUY order failed for %s: %s", symbol, e)
            return {"ok": False, "error": str(e)}

    def execute_sell(self, symbol: str, amount_crypto: Optional[float] = None) -> dict:
        """
        Place a market SELL order.
        amount_crypto defaults to your full free balance of that asset.
        Returns a result dict with success/error info.
        """
        base = symbol.split("/")[0]          # e.g. 'BTC' from 'BTC/EUR'
        price = self.states[symbol].last_price

        if not price:
            return {"ok": False, "error": "No price available"}

        qty = amount_crypto
        if not qty or qty <= 0:
            qty = self._get_balance(base)

        if qty <= 0:
            return {"ok": False, "error": f"No {base} balance to sell"}

        if TRADE_AMOUNT_EUR <= 0:
            logger.info("[DRY RUN] Would SELL %.6f %s at %.4f", qty, base, price)
            return {"ok": True, "dry_run": True, "symbol": symbol, "amount_crypto": qty}

        try:
            order = self.exchange.create_order(symbol, "market", "sell", qty)
            logger.info("SELL order placed for %s: %s", symbol, order.get("id"))
            self.states[symbol].last_action = "SELL"
            return {"ok": True, "dry_run": False, "order_id": order.get("id"), "symbol": symbol}
        except ccxt.InsufficientFunds:
            return {"ok": False, "error": f"Insufficient {base} balance"}
        except Exception as e:
            logger.error("SELL order failed for %s: %s", symbol, e)
            return {"ok": False, "error": str(e)}

    # ── Per-symbol processing ─────────────────────────────────────────────────

    def _process_symbol(self, symbol: str):
        state = self.states[symbol]
        price = self._fetch_ticker(symbol)

        if price is None:
            state.error = "Failed to fetch price"
            return

        state.error       = None
        state.last_price  = price
        state.last_updated = datetime.utcnow().isoformat() + "Z"

        hist = self._price_history[symbol]
        hist.append(price)
        if len(hist) > 200:
            self._price_history[symbol] = hist[-200:]

        # Indicators
        state.rsi      = compute_rsi(hist, RSI_PERIOD)
        state.ema_fast = compute_ema(hist, EMA_FAST)
        state.ema_slow = compute_ema(hist, EMA_SLOW)

        # Track session high
        if state.highest is None or price > state.highest:
            state.highest = price

        # ── Signal logic ──────────────────────────────────────────────────────
        drop_pct = (state.highest - price) / state.highest if state.highest else 0

        trailing_stop = drop_pct >= TRAILING_STOP_PCT
        ema_bullish   = (state.ema_fast is not None and state.ema_slow is not None
                         and state.ema_fast > state.ema_slow)
        rsi_oversold  = state.rsi is not None and state.rsi < RSI_OVERSOLD
        rsi_overbought = state.rsi is not None and state.rsi > RSI_OVERBOUGHT

        if trailing_stop or rsi_overbought:
            if state.last_action != "SELL":
                logger.warning(
                    "%s SELL signal — price=%.4f highest=%.4f drop=%.2f%% rsi=%s",
                    symbol, price, state.highest, drop_pct * 100,
                    f"{state.rsi:.1f}" if state.rsi else "N/A",
                )
                self.execute_sell(symbol)
            state.last_action = "SELL"

        elif rsi_oversold and ema_bullish:
            if state.last_action == "SELL":
                logger.info(
                    "%s BUY signal — rsi=%.1f ema_fast=%.4f ema_slow=%.4f",
                    symbol, state.rsi, state.ema_fast, state.ema_slow,
                )
                self.execute_buy(symbol)
            state.last_action = "BUY"

        else:
            state.last_action = "HOLD"

        logger.info(
            "%s price=%.4f drop=%.2f%% action=%s rsi=%s ema_fast=%s ema_slow=%s",
            symbol, price, drop_pct * 100, state.last_action,
            f"{state.rsi:.1f}"      if state.rsi      else "N/A",
            f"{state.ema_fast:.2f}" if state.ema_fast else "N/A",
            f"{state.ema_slow:.2f}" if state.ema_slow else "N/A",
        )

    # ── Public API ────────────────────────────────────────────────────────────

    def get_status(self) -> list[dict]:
        return [s.to_dict() for s in self.states.values()]

    async def run_loop(self, interval: int = 10):
        self._running = True
        logger.info("Trading bot started — symbols: %s | dry_run: %s",
                    SYMBOLS, TRADE_AMOUNT_EUR <= 0)

        # Seed indicators from historical data before first tick
        for symbol in SYMBOLS:
            self._seed_history(symbol)

        while self._running:
            for symbol in SYMBOLS:
                try:
                    self._process_symbol(symbol)
                except Exception as e:
                    logger.error("Unhandled error processing %s: %s", symbol, e)
                    self.states[symbol].error = str(e)
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False
