"""
Persistent configuration manager for the trading bot.

Config is stored in a JSON file (path configurable via CONFIG_DIR env var).
Falls back to defaults on first run. Kraken API credentials are encrypted
at rest using Fernet symmetric encryption, keyed from AUTH_SECRET env var.
"""

import base64
import hashlib
import json
import logging
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(os.getenv("CONFIG_DIR", ".")) / "bot_config.json"

# ── Profiles ──────────────────────────────────────────────────────────────────

PROFILES: dict[str, dict] = {
    "conservative": {
        "symbols":           ["BTC/EUR", "ETH/EUR", "SOL/EUR", "XRP/EUR"],
        "trade_amount_eur":  10.0,
        "trailing_stop_pct": 0.02,
        "take_profit_pct":   0.03,
        "rsi_period":        14,
        "rsi_oversold":      25.0,
        "rsi_overbought":    75.0,
        "rsi_timeframe":     "1h",
        "ema_fast":          9,
        "ema_slow":          21,
        "max_daily_loss_eur": 30.0,
        "webhook_url":       "",
    },
    "moderate": {
        "symbols":           ["BTC/EUR", "ETH/EUR", "SOL/EUR", "XRP/EUR", "ADA/EUR"],
        "trade_amount_eur":  20.0,
        "trailing_stop_pct": 0.03,
        "take_profit_pct":   0.05,
        "rsi_period":        14,
        "rsi_oversold":      30.0,
        "rsi_overbought":    70.0,
        "rsi_timeframe":     "1h",
        "ema_fast":          9,
        "ema_slow":          21,
        "max_daily_loss_eur": 50.0,
        "webhook_url":       "",
    },
    "aggressive": {
        "symbols":           ["BTC/EUR", "ETH/EUR", "SOL/EUR", "XRP/EUR", "ADA/EUR", "DOT/EUR", "AVAX/EUR", "NEAR/EUR"],
        "trade_amount_eur":  50.0,
        "trailing_stop_pct": 0.05,
        "take_profit_pct":   0.08,
        "rsi_period":        14,
        "rsi_oversold":      35.0,
        "rsi_overbought":    65.0,
        "rsi_timeframe":     "1h",
        "ema_fast":          9,
        "ema_slow":          21,
        "max_daily_loss_eur": 100.0,
        "webhook_url":       "",
    },
}
PROFILES["custom"] = deepcopy(PROFILES["moderate"])

DEFAULT_PROFILE = "moderate"
_OHLCV_REFRESH_MAP = {"1h": 360, "4h": 1440, "1d": 8640}


# ── Encryption helpers ────────────────────────────────────────────────────────

def _fernet():
    """Return a Fernet instance keyed from AUTH_SECRET, or None if not set."""
    try:
        from cryptography.fernet import Fernet
        secret = os.getenv("AUTH_SECRET", "")
        if not secret:
            return None
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
        return Fernet(key)
    except ImportError:
        return None


def _encrypt(value: str) -> str:
    f = _fernet()
    if not f or not value:
        return value
    return f.encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    f = _fernet()
    if not f or not value:
        return value
    try:
        return f.decrypt(value.encode()).decode()
    except Exception:
        return value  # already plaintext (pre-encryption migration)


# ── Config manager ────────────────────────────────────────────────────────────

class ConfigManager:
    def __init__(self):
        self._data: dict = {}
        self._kraken_key: str = ""
        self._kraken_secret: str = ""
        self.load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def load(self):
        if CONFIG_PATH.exists():
            try:
                raw = json.loads(CONFIG_PATH.read_text())
                self._data = {k: v for k, v in raw.items()
                              if k not in ("kraken_api_key", "kraken_api_secret")}
                self._kraken_key    = _decrypt(raw.get("kraken_api_key", ""))
                self._kraken_secret = _decrypt(raw.get("kraken_api_secret", ""))
                logger.info("Config loaded from %s", CONFIG_PATH)
                return
            except Exception as e:
                logger.warning("Config load failed (%s) — using defaults", e)
        # First run: seed from env vars
        self._data = deepcopy(PROFILES[DEFAULT_PROFILE])
        self._data["symbols"] = [
            s.strip()
            for s in os.getenv("SYMBOLS", ",".join(PROFILES[DEFAULT_PROFILE]["symbols"])).split(",")
            if s.strip()
        ]
        self._kraken_key    = os.getenv("KRAKEN_API_KEY",    "")
        self._kraken_secret = os.getenv("KRAKEN_API_SECRET", "")

    def save(self):
        try:
            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                **self._data,
                "kraken_api_key":    _encrypt(self._kraken_key),
                "kraken_api_secret": _encrypt(self._kraken_secret),
            }
            CONFIG_PATH.write_text(json.dumps(payload, indent=2))
        except Exception as e:
            logger.warning("Config save failed: %s", e)

    # ── Read ──────────────────────────────────────────────────────────────────

    def get(self, include_secrets: bool = False) -> dict:
        out = deepcopy(self._data)
        out["dry_run"] = self.dry_run
        if include_secrets:
            out["kraken_api_key"]    = self._kraken_key
            out["kraken_api_secret"] = self._kraken_secret
        else:
            out["kraken_api_key"]    = "••••" if self._kraken_key    else ""
            out["kraken_api_secret"] = "••••" if self._kraken_secret else ""
        return out

    def get_credentials(self) -> tuple[str, str]:
        return self._kraken_key, self._kraken_secret

    # ── Write ─────────────────────────────────────────────────────────────────

    def update(self, data: dict):
        """Merge data into config and persist. Handles credentials separately."""
        if "kraken_api_key" in data and data["kraken_api_key"] not in ("", "••••"):
            self._kraken_key = data.pop("kraken_api_key")
        else:
            data.pop("kraken_api_key", None)
        if "kraken_api_secret" in data and data["kraken_api_secret"] not in ("", "••••"):
            self._kraken_secret = data.pop("kraken_api_secret")
        else:
            data.pop("kraken_api_secret", None)
        data.pop("dry_run", None)
        self._data.update(data)
        self.save()

    def reset(self, profile: str = DEFAULT_PROFILE) -> dict:
        if profile not in PROFILES:
            raise ValueError(f"Unknown profile '{profile}'")
        self._data = deepcopy(PROFILES[profile])
        self.save()
        return self.get()

    # ── Accessors ─────────────────────────────────────────────────────────────

    @property
    def symbols(self) -> list[str]:
        return list(self._data.get("symbols", PROFILES[DEFAULT_PROFILE]["symbols"]))

    @property
    def trade_amount_eur(self) -> float:
        return float(self._data.get("trade_amount_eur", 20.0))

    @property
    def trailing_stop_pct(self) -> float:
        return float(self._data.get("trailing_stop_pct", 0.03))

    @property
    def take_profit_pct(self) -> float:
        return float(self._data.get("take_profit_pct", 0.05))

    @property
    def rsi_period(self) -> int:
        return int(self._data.get("rsi_period", 14))

    @property
    def rsi_oversold(self) -> float:
        return float(self._data.get("rsi_oversold", 30.0))

    @property
    def rsi_overbought(self) -> float:
        return float(self._data.get("rsi_overbought", 70.0))

    @property
    def rsi_timeframe(self) -> str:
        return self._data.get("rsi_timeframe", "1h")

    @property
    def ohlcv_refresh_ticks(self) -> int:
        return _OHLCV_REFRESH_MAP.get(self.rsi_timeframe, 360)

    @property
    def ema_fast(self) -> int:
        return int(self._data.get("ema_fast", 9))

    @property
    def ema_slow(self) -> int:
        return int(self._data.get("ema_slow", 21))

    @property
    def max_daily_loss_eur(self) -> float:
        return float(self._data.get("max_daily_loss_eur", 0.0))

    @property
    def webhook_url(self) -> str:
        return self._data.get("webhook_url", "")

    @property
    def dry_run(self) -> bool:
        return self.trade_amount_eur <= 0


cfg = ConfigManager()
