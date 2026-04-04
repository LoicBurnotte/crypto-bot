"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTrades, type Trade } from "@/lib/api";
import styles from "./TradeHistory.module.css";

export default function TradeHistory() {
  const [trades,  setTrades]  = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchTrades(50);
      setTrades(res.trades);
    } catch {
      // no-op — may fail if no API keys configured
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [open, load]);

  const buyCount  = trades.filter(t => t.side === "buy").length;
  const sellCount = trades.filter(t => t.side === "sell").length;
  const totalPnl  = trades.reduce((s, t) => s + (t.pnl_eur ?? 0), 0);

  return (
    <div className={styles.wrapper}>
      <button className={styles.toggle} onClick={() => setOpen(o => !o)}>
        <span>Trade History</span>
        <span className={styles.toggleMeta}>
          {trades.length} trades · P&amp;L:{" "}
          <span style={{ color: totalPnl >= 0 ? "var(--green)" : "var(--red)" }}>
            {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} EUR
          </span>
        </span>
        <span className={styles.chevron}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className={styles.panel}>
          {/* Summary row */}
          <div className={styles.summary}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Buys</span>
              <span style={{ color: "var(--green)", fontWeight: 700 }}>{buyCount}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Sells</span>
              <span style={{ color: "var(--red)", fontWeight: 700 }}>{sellCount}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Total P&amp;L</span>
              <span style={{ color: totalPnl >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} EUR
              </span>
            </div>
            <button className={styles.reloadBtn} onClick={load}>↻ Refresh</button>
          </div>

          {loading ? (
            <div className={styles.centered}><div className={styles.spinner} /></div>
          ) : trades.length === 0 ? (
            <p className={styles.empty}>No trades yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Amount</th>
                    <th>P&amp;L</th>
                    <th>Reason</th>
                    <th>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={i}>
                      <td className={styles.time}>
                        {new Date(t.timestamp).toLocaleString([], {
                          month: "short", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className={styles.symbol}>{t.symbol}</td>
                      <td>
                        <span className={`${styles.sideBadge} ${t.side === "buy" ? styles.buy : styles.sell}`}>
                          {t.side.toUpperCase()}
                        </span>
                      </td>
                      <td className={styles.num}>
                        €{t.price?.toLocaleString("en-EU", { maximumFractionDigits: 4 }) ?? "—"}
                      </td>
                      <td className={styles.num}>
                        {t.amount_eur != null
                          ? `€${t.amount_eur.toFixed(2)}`
                          : t.amount_crypto != null
                          ? t.amount_crypto.toFixed(6)
                          : "—"}
                      </td>
                      <td className={styles.num} style={{
                        color: t.pnl_eur == null ? "var(--text-muted)"
                             : t.pnl_eur >= 0    ? "var(--green)"
                             : "var(--red)",
                      }}>
                        {t.pnl_eur != null
                          ? `${t.pnl_eur >= 0 ? "+" : ""}${t.pnl_eur.toFixed(2)}`
                          : "—"}
                      </td>
                      <td className={styles.reason}>{t.reason ?? "—"}</td>
                      <td>
                        {t.dry_run
                          ? <span className={styles.dryTag}>DRY</span>
                          : <span className={styles.liveTag}>LIVE</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
