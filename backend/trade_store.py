"""
Append-only trade log with file persistence.

Every trade is written as a single JSON line to bot_trades.jsonl
so no trade is ever lost — even across restarts and redeployments.
The in-memory list is rebuilt from the file at startup.

File location follows CONFIG_DIR env var (same as config.py).
"""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)

TRADES_PATH = Path(os.getenv("CONFIG_DIR", ".")) / "bot_trades.jsonl"


class TradeStore:
    """Thread-safe, append-only trade log backed by a .jsonl file."""

    def __init__(self):
        self._trades: list[dict] = []
        self._lock = Lock()
        self._load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self):
        if not TRADES_PATH.exists():
            return
        try:
            lines = TRADES_PATH.read_text(encoding="utf-8").splitlines()
            for line in lines:
                line = line.strip()
                if line:
                    self._trades.append(json.loads(line))
            logger.info("Trade store loaded — %d trades from %s", len(self._trades), TRADES_PATH)
        except Exception as e:
            logger.warning("Trade store load failed (%s) — starting empty", e)

    def _append_to_file(self, entry: dict):
        try:
            TRADES_PATH.parent.mkdir(parents=True, exist_ok=True)
            with TRADES_PATH.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error("Trade store write failed: %s", e)

    # ── Public API ────────────────────────────────────────────────────────────

    def record(self, **kwargs) -> dict:
        entry = {"timestamp": datetime.utcnow().isoformat() + "Z", **kwargs}
        with self._lock:
            self._trades.append(entry)
            self._append_to_file(entry)
        return entry

    def all(self) -> list[dict]:
        """All trades, newest first."""
        with self._lock:
            return list(reversed(self._trades))

    def for_export(self, year: int | None = None) -> list[dict]:
        """All trades oldest-first, optionally filtered to a calendar year."""
        with self._lock:
            trades = list(self._trades)          # oldest first
        if year is not None:
            prefix = str(year)
            trades = [t for t in trades if t.get("timestamp", "").startswith(prefix)]
        return trades

    def available_years(self) -> list[int]:
        """Distinct years present in the log, descending."""
        with self._lock:
            years = {int(t["timestamp"][:4]) for t in self._trades if t.get("timestamp")}
        return sorted(years, reverse=True)

    def count(self) -> int:
        with self._lock:
            return len(self._trades)

    def summary(self) -> dict:
        """Aggregate stats across all persisted trades."""
        with self._lock:
            trades = list(self._trades)
        buys        = [t for t in trades if t.get("side") == "buy"]
        sells       = [t for t in trades if t.get("side") == "sell"]
        live_sells  = [t for t in sells  if not t.get("dry_run")]
        all_time_pnl = round(sum(t.get("pnl_eur") or 0 for t in sells), 2)
        return {
            "total_trades":  len(trades),
            "buy_count":     len(buys),
            "sell_count":    len(sells),
            "live_trades":   len(live_sells),
            "all_time_pnl":  all_time_pnl,
        }
