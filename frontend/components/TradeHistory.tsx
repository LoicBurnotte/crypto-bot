"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTrades, type Trade, type TradeHistoryResponse } from "@/lib/api";
import styles from "./TradeHistory.module.css";

const PAGE    = 100;
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

async function fetchYears(): Promise<number[]> {
  try {
    const res = await fetch(`${API_URL}/trades/years`, { cache: "no-store" });
    const data = await res.json();
    return data.years ?? [];
  } catch {
    return [];
  }
}

function downloadExport(year: number | "all", format: "csv" | "xlsx") {
  const yearParam = year === "all" ? "" : `&year=${year}`;
  const url = `${API_URL}/trades/export?format=${format}${yearParam}`;
  // Trigger browser download
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function TradeHistory() {
  const [res,          setRes]          = useState<TradeHistoryResponse | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [open,         setOpen]         = useState(false);
  const [offset,       setOffset]       = useState(0);
  const [years,        setYears]        = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | "all">("all");

  const load = useCallback(async (off = 0) => {
    try {
      const data = await fetchTrades(PAGE, off);
      setRes(data);
      setOffset(off);
    } catch {
      // silent — may fail until API keys are configured
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(0); fetchYears().then(setYears); }, [load]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => load(offset), 10_000);
    return () => clearInterval(t);
  }, [open, load, offset]);

  // Reload page 1 when year filter changes
  useEffect(() => { load(0); }, [selectedYear, load]);

  const trades     = res?.trades ?? [];
  const total      = res?.total ?? 0;
  const allTimePnl = res?.all_time_pnl ?? 0;
  const buyCount   = res?.buy_count   ?? 0;
  const sellCount  = res?.sell_count  ?? 0;
  const liveCount  = res?.live_trades ?? 0;

  // P&L for the current visible page
  const pagePnl = trades.reduce((s, t) => s + (t.pnl_eur ?? 0), 0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const currentPage = Math.floor(offset / PAGE) + 1;

  return (
    <div className={styles.wrapper}>
      <button className={styles.toggle} onClick={() => setOpen(o => !o)}>
        <span>Trade History</span>
        <span className={styles.toggleMeta}>
          {total} trade{total !== 1 ? "s" : ""} · All-time P&amp;L:{" "}
          <span style={{ color: allTimePnl >= 0 ? "var(--green)" : "var(--red)" }}>
            {allTimePnl >= 0 ? "+" : ""}{allTimePnl.toFixed(2)} €
          </span>
        </span>
        <span className={styles.chevron}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className={styles.panel}>
          {/* Summary row */}
          <div className={styles.summary}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Total trades</span>
              <span style={{ fontWeight: 700 }}>{total}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Buys / Sells</span>
              <span style={{ fontWeight: 700 }}>
                <span style={{ color: "var(--green)" }}>{buyCount}</span>
                {" / "}
                <span style={{ color: "var(--red)" }}>{sellCount}</span>
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Live trades</span>
              <span style={{ fontWeight: 700 }}>{liveCount}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>All-time P&amp;L</span>
              <span style={{
                color: allTimePnl >= 0 ? "var(--green)" : "var(--red)",
                fontWeight: 700,
              }}>
                {allTimePnl >= 0 ? "+" : ""}{allTimePnl.toFixed(2)} €
              </span>
            </div>
            <button className={styles.reloadBtn} onClick={() => load(offset)}>↻</button>
          </div>

          {/* Export toolbar */}
          <div className={styles.exportBar}>
            <span className={styles.exportLabel}>Export:</span>
            <select
              className={styles.yearSelect}
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value === "all" ? "all" : Number(e.target.value))}
            >
              <option value="all">All years</option>
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              className={styles.exportBtn}
              onClick={() => downloadExport(selectedYear, "csv")}
              title="Download CSV"
            >
              ↓ CSV
            </button>
            <button
              className={`${styles.exportBtn} ${styles.exportXlsx}`}
              onClick={() => downloadExport(selectedYear, "xlsx")}
              title="Download Excel"
            >
              ↓ Excel
            </button>
          </div>

          {loading ? (
            <div className={styles.centered}><div className={styles.spinner} /></div>
          ) : trades.length === 0 ? (
            <p className={styles.empty}>No trades recorded yet.</p>
          ) : (
            <>
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
                      <tr key={`${t.timestamp}-${i}`}>
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
                            ? `${t.pnl_eur >= 0 ? "+" : ""}${t.pnl_eur.toFixed(2)} €`
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

              {/* Pagination */}
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button
                    className={styles.pageBtn}
                    disabled={offset === 0}
                    onClick={() => load(0)}
                  >«</button>
                  <button
                    className={styles.pageBtn}
                    disabled={offset === 0}
                    onClick={() => load(Math.max(0, offset - PAGE))}
                  >‹</button>
                  <span className={styles.pageInfo}>
                    Page {currentPage} / {totalPages} · {total} trades
                  </span>
                  <button
                    className={styles.pageBtn}
                    disabled={offset + PAGE >= total}
                    onClick={() => load(offset + PAGE)}
                  >›</button>
                  <button
                    className={styles.pageBtn}
                    disabled={offset + PAGE >= total}
                    onClick={() => load((totalPages - 1) * PAGE)}
                  >»</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
