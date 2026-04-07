import asyncio
import logging
import os
from datetime import datetime, date
from typing import Optional

import ccxt
import httpx

from config import cfg

logger = logging.getLogger(__name__)

_OHLCV_REFRESH_MAP = {"1h": 360, "4h": 1440, "1d": 8640}


# ── Indicators ────────────────────────────────────────────────────────────────

def compute_rsi(prices: list[float], period: int) -> Optional[float]:
    """Wilder's smoothed RSI."""
    if len(prices) < period + 1:
        return None
    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    avg_gain = sum(max(d, 0.0) for d in deltas[:period]) / period
    avg_loss = sum(abs(min(d, 0.0)) for d in deltas[:period]) / period
    for delta in deltas[period:]:
        avg_gain = (avg_gain * (period - 1) + max(delta, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + abs(min(delta, 0.0))) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))


def compute_ema(prices: list[float], period: int) -> Optional[float]:
    if len(prices) < period:
        return None
    k = 2.0 / (period + 1)
    ema = sum(prices[:period]) / period
    for p in prices[period:]:
        ema = p * k + ema * (1 - k)
    return ema


# ── Trade log ─────────────────────────────────────────────────────────────────

class TradeLog:
    MAX_ENTRIES = 500

    def __init__(self):
        self._trades: list[dict] = []

    def record(self, **kwargs) -> dict:
        entry = {"timestamp": datetime.utcnow().isoformat() + "Z", **kwargs}
        self._trades.append(entry)
        if len(self._trades) > self.MAX_ENTRIES:
            self._trades = self._trades[-self.MAX_ENTRIES:]
        return entry

    def all(self) -> list[dict]:
        return list(reversed(self._trades))


# ── Asset state ───────────────────────────────────────────────────────────────

class AssetState:
    def __init__(self, symbol: str):
        self.symbol        = symbol
        self.last_price:   Optional[float] = None
        self.highest:      Optional[float] = None
        self.entry_price:  Optional[float] = None
        self.last_action:  str             = "HOLD"
        self.rsi:          Optional[float] = None
        self.ema_fast:     Optional[float] = None
        self.ema_slow:     Optional[float] = None
        self.last_updated: Optional[str]   = None
        self.error:        Optional[str]   = None
        self.hold_until_overbought: bool   = False
        self.disabled:     bool            = False

    @property
    def unrealised_pnl_pct(self) -> Optional[float]:
        if self.entry_price and self.last_price:
            return (self.last_price - self.entry_price) / self.entry_price * 100
        return None

    def to_dict(self) -> dict:
        drop_pct = None
        if self.highest and self.last_price:
            drop_pct = round((self.highest - self.last_price) / self.highest * 100, 2)
        return {
            "symbol":                self.symbol,
            "last_price":            self.last_price,
            "highest":               self.highest,
            "entry_price":           self.entry_price,
            "last_action":           self.last_action,
            "rsi":                   round(self.rsi, 2)      if self.rsi      is not None else None,
            "ema_fast":              round(self.ema_fast, 4) if self.ema_fast is not None else None,
            "ema_slow":              round(self.ema_slow, 4) if self.ema_slow is not None else None,
            "unrealised_pnl_pct":    round(self.unrealised_pnl_pct, 2) if self.unrealised_pnl_pct is not None else None,
            "drop_pct":              drop_pct,
            "dry_run":               cfg.dry_run,
            "hold_until_overbought": self.hold_until_overbought,
            "rsi_overbought_target": cfg.rsi_overbought,
            "disabled":              self.disabled,
            "last_updated":          self.last_updated,
            "error":                 self.error,
        }


# ── Bot ───────────────────────────────────────────────────────────────────────

class TradingBot:
    def __init__(self):
        key, secret = cfg.get_credentials()
        self.exchange = ccxt.kraken({
            "apiKey":          key,
            "secret":          secret,
            "enableRateLimit": True,
        })
        self.states:         dict[str, AssetState]  = {s: AssetState(s) for s in cfg.symbols}
        self._price_history: dict[str, list[float]] = {s: [] for s in cfg.symbols}
        self._ohlcv_history: dict[str, list[float]] = {s: [] for s in cfg.symbols}
        self._ohlcv_tick:    dict[str, int]          = {s: 0  for s in cfg.symbols}

        self.trade_log     = TradeLog()
        self._running      = False
        self._daily_pnl    = 0.0
        self._last_pnl_date = date.today()
        self._paused_loss  = False

    # ── Config reload ─────────────────────────────────────────────────────────

    def reload_exchange(self):
        """Reinitialise the ccxt exchange with updated credentials from cfg."""
        key, secret = cfg.get_credentials()
        self.exchange = ccxt.kraken({
            "apiKey":          key,
            "secret":          secret,
            "enableRateLimit": True,
        })
        logger.info("Exchange reloaded with updated credentials")

    def sync_symbols(self):
        """Add states for new symbols; preserve existing ones."""
        for s in cfg.symbols:
            if s not in self.states:
                self.states[s]         = AssetState(s)
                self._price_history[s] = []
                self._ohlcv_history[s] = []
                self._ohlcv_tick[s]    = 0
                logger.info("Symbol added: %s", s)

    # ── Notifications ─────────────────────────────────────────────────────────

    async def _notify(self, text: str):
        if not cfg.webhook_url:
            return
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(cfg.webhook_url, json={"content": text, "text": text})
        except Exception as e:
            logger.warning("Webhook failed: %s", e)

    # ── Exchange helpers ──────────────────────────────────────────────────────

    def _fetch_ticker(self, symbol: str) -> Optional[float]:
        try:
            return float(self.exchange.fetch_ticker(symbol)["last"])
        except ccxt.NetworkError  as e: logger.warning("Network error %s: %s",   symbol, e)
        except ccxt.ExchangeError as e: logger.warning("Exchange error %s: %s",  symbol, e)
        except Exception          as e: logger.error("Unexpected error %s: %s",  symbol, e)
        return None

    def fetch_ohlcv(self, symbol: str, timeframe: str = "1h", limit: int = 100) -> list[dict]:
        try:
            raw = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
            return [
                {
                    "timestamp": int(c[0]),
                    "time":      datetime.utcfromtimestamp(c[0] / 1000).isoformat() + "Z",
                    "open":  c[1], "high": c[2], "low": c[3], "close": c[4], "volume": c[5],
                }
                for c in raw
            ]
        except Exception as e:
            logger.warning("OHLCV fetch failed %s/%s: %s", symbol, timeframe, e)
            return []

    def _refresh_ohlcv_history(self, symbol: str):
        try:
            ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe=cfg.rsi_timeframe, limit=100)
            self._ohlcv_history[symbol] = [c[4] for c in ohlcv]
            logger.info("OHLCV refreshed %s (%s, %d candles)", symbol, cfg.rsi_timeframe, len(ohlcv))
        except Exception as e:
            logger.warning("OHLCV refresh failed %s: %s", symbol, e)

    def _seed_history(self, symbol: str):
        self._refresh_ohlcv_history(symbol)
        self._price_history[symbol] = list(self._ohlcv_history[symbol])

    def _get_balance(self, currency: str) -> float:
        try:
            return float(self.exchange.fetch_balance().get(currency, {}).get("free", 0.0))
        except Exception as e:
            logger.warning("Balance fetch failed %s: %s", currency, e)
            return 0.0

    # ── Risk management ───────────────────────────────────────────────────────

    def _check_daily_reset(self):
        today = date.today()
        if today != self._last_pnl_date:
            self._daily_pnl     = 0.0
            self._last_pnl_date = today
            self._paused_loss   = False
            logger.info("Daily P&L reset")

    def _record_pnl(self, pnl_eur: float):
        self._daily_pnl += pnl_eur
        limit = cfg.max_daily_loss_eur
        if limit > 0 and self._daily_pnl <= -abs(limit):
            self._paused_loss = True
            logger.warning("Daily loss limit reached (%.2f EUR). Bot paused.", self._daily_pnl)

    # ── Order execution ───────────────────────────────────────────────────────

    def execute_buy(self, symbol: str, amount_eur: Optional[float] = None, reason: str = "manual") -> dict:
        eur   = amount_eur if (amount_eur and amount_eur > 0) else cfg.trade_amount_eur
        price = self.states[symbol].last_price
        if not price:
            return {"ok": False, "error": "No price available"}

        if eur <= 0:
            entry = self.trade_log.record(symbol=symbol, side="buy", price=price,
                                          amount_eur=eur, dry_run=True, reason=reason)
            logger.info("[DRY RUN] Would BUY %.2f EUR of %s @ %.4f", eur, symbol, price)
            self.states[symbol].entry_price = price
            self.states[symbol].last_action = "BUY"
            return {"ok": True, "dry_run": True, **entry}

        amount_crypto = eur / price
        try:
            order = self.exchange.create_order(symbol, "market", "buy", amount_crypto)
            self._record_pnl(-eur)
            self.states[symbol].entry_price = price
            self.states[symbol].last_action = "BUY"
            entry = self.trade_log.record(symbol=symbol, side="buy", price=price,
                                          amount_eur=eur, order_id=order.get("id"),
                                          dry_run=False, reason=reason)
            asyncio.create_task(self._notify(
                f"🟢 BUY {symbol} | €{eur:.2f} @ {price:.4f} | {reason}"
            ))
            return {"ok": True, "dry_run": False, "order_id": order.get("id"), **entry}
        except ccxt.InsufficientFunds:
            return {"ok": False, "error": "Insufficient EUR balance"}
        except Exception as e:
            logger.error("BUY failed %s: %s", symbol, e)
            return {"ok": False, "error": str(e)}

    def execute_sell(self, symbol: str, amount_crypto: Optional[float] = None, reason: str = "manual") -> dict:
        base  = symbol.split("/")[0]
        price = self.states[symbol].last_price
        if not price:
            return {"ok": False, "error": "No price available"}

        qty = amount_crypto or 0
        if qty <= 0:
            qty = self._get_balance(base)

        entry_price = self.states[symbol].entry_price
        pnl_eur = (price - entry_price) * qty if entry_price else 0.0

        if cfg.dry_run:
            entry = self.trade_log.record(symbol=symbol, side="sell", price=price,
                                          amount_crypto=qty, pnl_eur=0, dry_run=True, reason=reason)
            logger.info("[DRY RUN] Would SELL %.6f %s @ %.4f", qty, base, price)
            self.states[symbol].entry_price = None
            self.states[symbol].last_action = "SELL"
            return {"ok": True, "dry_run": True, **entry}

        if qty <= 0:
            return {"ok": False, "error": f"No {base} balance to sell"}

        try:
            order = self.exchange.create_order(symbol, "market", "sell", qty)
            self._record_pnl(pnl_eur)
            self.states[symbol].entry_price = None
            self.states[symbol].last_action = "SELL"
            entry = self.trade_log.record(symbol=symbol, side="sell", price=price,
                                          amount_crypto=qty, pnl_eur=round(pnl_eur, 2),
                                          order_id=order.get("id"), dry_run=False, reason=reason)
            pnl_str = f"{'+'if pnl_eur >= 0 else ''}{pnl_eur:.2f} EUR"
            asyncio.create_task(self._notify(
                f"🔴 SELL {symbol} | {qty:.6f} {base} @ {price:.4f} | P&L: {pnl_str} | {reason}"
            ))
            return {"ok": True, "dry_run": False, "order_id": order.get("id"),
                    "pnl_eur": round(pnl_eur, 2), **entry}
        except ccxt.InsufficientFunds:
            return {"ok": False, "error": f"Insufficient {base} balance"}
        except Exception as e:
            logger.error("SELL failed %s: %s", symbol, e)
            return {"ok": False, "error": str(e)}

    # ── Signal processing ─────────────────────────────────────────────────────

    def _process_symbol(self, symbol: str):
        state = self.states[symbol]
        if state.disabled:
            return

        price = self._fetch_ticker(symbol)
        if price is None:
            state.error = "Failed to fetch price"
            return

        state.error        = None
        state.last_price   = price
        state.last_updated = datetime.utcnow().isoformat() + "Z"

        hist = self._price_history[symbol]
        hist.append(price)
        if len(hist) > 500:
            self._price_history[symbol] = hist[-500:]

        self._ohlcv_tick[symbol] += 1
        if self._ohlcv_tick[symbol] >= cfg.ohlcv_refresh_ticks:
            self._ohlcv_tick[symbol] = 0
            self._refresh_ohlcv_history(symbol)

        ohlcv_hist     = self._ohlcv_history[symbol]
        state.rsi      = compute_rsi(ohlcv_hist, cfg.rsi_period)
        state.ema_fast = compute_ema(ohlcv_hist, cfg.ema_fast)
        state.ema_slow = compute_ema(ohlcv_hist, cfg.ema_slow)

        if state.highest is None or price > state.highest:
            state.highest = price

        if self._paused_loss:
            state.last_action = "HOLD"
            return

        drop_pct       = (state.highest - price) / state.highest if state.highest else 0
        take_profit    = bool(state.entry_price and price >= state.entry_price * (1 + cfg.take_profit_pct))
        trailing_stop  = drop_pct >= cfg.trailing_stop_pct
        rsi_overbought = state.rsi is not None and state.rsi >= cfg.rsi_overbought
        rsi_oversold   = state.rsi is not None and state.rsi < cfg.rsi_oversold
        ema_bullish    = (state.ema_fast is not None and state.ema_slow is not None
                         and state.ema_fast > state.ema_slow)

        if state.hold_until_overbought:
            if rsi_overbought:
                logger.info("%s hold_until_overbought triggered at RSI=%.1f", symbol, state.rsi)
                if state.last_action != "SELL":
                    self.execute_sell(symbol, reason=f"hold_until_overbought (RSI={state.rsi:.1f})")
                state.hold_until_overbought = False
                state.last_action = "SELL"
            else:
                state.last_action = "HOLD"
            return

        if take_profit:
            if state.last_action != "SELL":
                self.execute_sell(symbol, reason=f"take_profit ({cfg.take_profit_pct*100:.0f}%)")
            state.last_action = "SELL"
        elif trailing_stop or rsi_overbought:
            reason = "trailing_stop" if trailing_stop else "rsi_overbought"
            if state.last_action != "SELL":
                self.execute_sell(symbol, reason=reason)
            state.last_action = "SELL"
        elif rsi_oversold and ema_bullish:
            if state.last_action == "SELL":
                self.execute_buy(symbol, reason="rsi_oversold+ema_bullish")
            state.last_action = "BUY"
        else:
            state.last_action = "HOLD"

        logger.info("%s %.4f | %s | RSI=%s drop=%.2f%% pnl=%s",
            symbol, price, state.last_action,
            f"{state.rsi:.1f}" if state.rsi else "N/A",
            drop_pct * 100,
            f"{state.unrealised_pnl_pct:.2f}%" if state.unrealised_pnl_pct is not None else "N/A")

    # ── Public ────────────────────────────────────────────────────────────────

    def get_status(self) -> list[dict]:
        return [s.to_dict() for s in self.states.values()]

    async def _async_seed(self, symbol: str):
        try:
            await asyncio.to_thread(self._seed_history, symbol)
        except Exception as e:
            logger.error("Seed failed %s: %s", symbol, e)

    async def _async_process(self, symbol: str):
        try:
            await asyncio.to_thread(self._process_symbol, symbol)
        except Exception as e:
            logger.error("Error processing %s: %s", symbol, e)
            self.states[symbol].error = str(e)

    async def run_loop(self, interval: int = 10):
        self._running = True
        self.sync_symbols()
        logger.info("Bot started | symbols=%s | dry_run=%s", cfg.symbols, cfg.dry_run)
        await asyncio.gather(*[self._async_seed(s) for s in cfg.symbols])
        while self._running:
            self._check_daily_reset()
            self.sync_symbols()
            await asyncio.gather(*[self._async_process(s) for s in cfg.symbols])
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False
