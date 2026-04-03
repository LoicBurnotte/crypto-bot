import os
import logging
import asyncio
from datetime import datetime
from typing import Optional
import ccxt

logger = logging.getLogger(__name__)

SYMBOLS = ["BTC/EUR", "ETH/EUR", "SOL/EUR"]
TRAILING_STOP_PCT = 0.03  # 3%
RSI_PERIOD = 14
RSI_OVERSOLD = 30
RSI_OVERBOUGHT = 70


class AssetState:
    def __init__(self, symbol: str):
        self.symbol = symbol
        self.last_price: Optional[float] = None
        self.highest: Optional[float] = None
        self.last_action: str = "HOLD"
        self.rsi: Optional[float] = None
        self.last_updated: Optional[str] = None
        self.error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "last_price": self.last_price,
            "highest": self.highest,
            "last_action": self.last_action,
            "rsi": round(self.rsi, 2) if self.rsi is not None else None,
            "last_updated": self.last_updated,
            "error": self.error,
        }


def compute_rsi(prices: list[float], period: int = RSI_PERIOD) -> Optional[float]:
    """Compute RSI from a list of closing prices."""
    if len(prices) < period + 1:
        return None

    gains, losses = [], []
    for i in range(1, period + 1):
        delta = prices[-(period + 1) + i] - prices[-(period + 1) + i - 1]
        if delta >= 0:
            gains.append(delta)
            losses.append(0.0)
        else:
            gains.append(0.0)
            losses.append(abs(delta))

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    if avg_loss == 0:
        return 100.0

    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


class TradingBot:
    def __init__(self):
        self.exchange = ccxt.kraken(
            {
                "apiKey": os.getenv("KRAKEN_API_KEY", ""),
                "secret": os.getenv("KRAKEN_API_SECRET", ""),
                "enableRateLimit": True,
            }
        )
        self.states: dict[str, AssetState] = {s: AssetState(s) for s in SYMBOLS}
        self._price_history: dict[str, list[float]] = {s: [] for s in SYMBOLS}
        self._running = False

    def _fetch_ticker(self, symbol: str) -> Optional[float]:
        try:
            ticker = self.exchange.fetch_ticker(symbol)
            return float(ticker["last"])
        except ccxt.NetworkError as e:
            logger.warning("Network error fetching %s: %s", symbol, e)
        except ccxt.ExchangeError as e:
            logger.warning("Exchange error fetching %s: %s", symbol, e)
        except Exception as e:
            logger.error("Unexpected error fetching %s: %s", symbol, e)
        return None

    def _fetch_ohlcv_prices(self, symbol: str) -> list[float]:
        try:
            ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe="1h", limit=RSI_PERIOD + 2)
            return [candle[4] for candle in ohlcv]  # closing prices
        except Exception as e:
            logger.warning("Could not fetch OHLCV for %s: %s", symbol, e)
            return []

    def _execute_buy(self, symbol: str, price: float):
        """Placeholder for buy logic."""
        logger.info("[BUY PLACEHOLDER] Would buy %s at %.4f", symbol, price)
        # TODO: Implement actual buy order via self.exchange.create_order(...)

    def _execute_sell(self, symbol: str, price: float):
        """Placeholder for sell logic."""
        logger.info("[SELL PLACEHOLDER] Would sell %s at %.4f", symbol, price)
        # TODO: Implement actual sell order via self.exchange.create_order(...)

    def _process_symbol(self, symbol: str):
        state = self.states[symbol]
        price = self._fetch_ticker(symbol)

        if price is None:
            state.error = "Failed to fetch price"
            return

        state.error = None
        state.last_price = price
        state.last_updated = datetime.utcnow().isoformat() + "Z"

        # Update price history for RSI
        self._price_history[symbol].append(price)
        if len(self._price_history[symbol]) > RSI_PERIOD + 10:
            self._price_history[symbol] = self._price_history[symbol][-(RSI_PERIOD + 10):]

        # Try fetching OHLCV for more accurate RSI on startup
        if len(self._price_history[symbol]) < RSI_PERIOD + 1:
            historical = self._fetch_ohlcv_prices(symbol)
            if historical:
                self._price_history[symbol] = historical + self._price_history[symbol]

        state.rsi = compute_rsi(self._price_history[symbol])

        # Update highest price
        if state.highest is None or price > state.highest:
            state.highest = price
            logger.info("%s new highest: %.4f", symbol, price)

        # Trailing stop-loss check
        if state.highest is not None:
            drop_pct = (state.highest - price) / state.highest
            if drop_pct >= TRAILING_STOP_PCT:
                if state.last_action != "SELL":
                    logger.warning(
                        "%s trailing stop triggered: price=%.4f highest=%.4f drop=%.2f%%",
                        symbol, price, state.highest, drop_pct * 100,
                    )
                    self._execute_sell(symbol, price)
                state.last_action = "SELL"
            else:
                # RSI-based buy signal placeholder
                if state.rsi is not None and state.rsi < RSI_OVERSOLD:
                    if state.last_action == "SELL":
                        logger.info("%s RSI oversold (%.1f), buy signal", symbol, state.rsi)
                        self._execute_buy(symbol, price)
                    state.last_action = "BUY"
                else:
                    state.last_action = "HOLD"

        logger.info(
            "%s price=%.4f highest=%.4f action=%s rsi=%s",
            symbol,
            price,
            state.highest or 0,
            state.last_action,
            f"{state.rsi:.1f}" if state.rsi else "N/A",
        )

    def get_status(self) -> list[dict]:
        return [state.to_dict() for state in self.states.values()]

    async def run_loop(self, interval: int = 10):
        self._running = True
        logger.info("Trading bot started. Symbols: %s", SYMBOLS)
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
