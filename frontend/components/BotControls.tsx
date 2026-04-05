"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchBotStatus, fetchPortfolio,
  startBot, stopBot, liquidateAll, withdrawEur,
  type BotStatus, type Portfolio,
} from "@/lib/api";
import styles from "./BotControls.module.css";

type ModalType = "liquidate" | "withdraw" | null;

function fmt(n: number | null | undefined, decimals = 2, prefix = "") {
  if (n == null) return "—";
  return `${prefix}${n.toLocaleString("en-EU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function PnlValue({ value }: { value: number | null }) {
  if (value == null) return <span className={styles.muted}>—</span>;
  const color = value >= 0 ? "var(--green)" : "var(--red)";
  return <span style={{ color, fontWeight: 700 }}>{value >= 0 ? "+" : ""}{fmt(value)} €</span>;
}

export default function BotControls() {
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [modal,     setModal]     = useState<ModalType>(null);
  const [loading,   setLoading]   = useState<string | null>(null);
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null);
  const [wAmount,   setWAmount]   = useState("");
  const [wKey,      setWKey]      = useState("");

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  };

  const refresh = useCallback(async () => {
    try {
      const [bs, pf] = await Promise.all([fetchBotStatus(), fetchPortfolio()]);
      setBotStatus(bs);
      setPortfolio(pf);
    } catch { /* no API keys — silently skip */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function handleToggleBot() {
    if (!botStatus) return;
    setLoading("toggle");
    try {
      const res = botStatus.running ? await stopBot() : await startBot();
      setBotStatus(prev => prev ? { ...prev, running: res.running } : res);
      showToast(res.running ? "Bot started" : "Bot stopped", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", false);
    } finally { setLoading(null); }
  }

  async function handleLiquidate() {
    setLoading("liquidate");
    setModal(null);
    try {
      const res  = await liquidateAll();
      const ok   = res.results.every(r => r.ok);
      const dry  = res.results[0]?.dry_run;
      showToast(
        dry  ? "[Dry-run] Would sell all positions to EUR"
             : ok ? "All positions sold to EUR" : "Some orders failed — check logs",
        ok,
      );
      refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Liquidation failed", false);
    } finally { setLoading(null); }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setLoading("withdraw");
    setModal(null);
    try {
      await withdrawEur(parseFloat(wAmount), wKey);
      showToast(`Withdrawal of €${wAmount} initiated`, true);
      setWAmount(""); setWKey("");
      refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Withdrawal failed", false);
    } finally { setLoading(null); }
  }

  // Separate EUR from crypto balances
  const eurEntry   = portfolio?.balances?.["EUR"] ?? portfolio?.balances?.["ZEUR"] ?? null;
  const eurBalance = eurEntry?.free ?? null;

  const cryptoRows = portfolio
    ? Object.entries(portfolio.balances)
        .filter(([c]) => c !== "EUR" && c !== "ZEUR")
        .sort((a, b) => (b[1].eur_value ?? 0) - (a[1].eur_value ?? 0))
    : [];

  const totalUnrealised = cryptoRows.reduce(
    (sum, [, b]) => sum + (b.unrealised_pnl_eur ?? 0), 0,
  );

  return (
    <div className={styles.wrapper}>

      {/* ── Bot status + action buttons ──────────────────── */}
      <div className={styles.controlBar}>
        <div className={styles.statusGroup}>
          <span className={styles.dot}
            style={{ background: botStatus?.running ? "var(--green)" : "var(--red)" }} />
          <span className={styles.statusLabel}>
            {botStatus ? (botStatus.running ? "Bot running" : "Bot stopped") : "Connecting…"}
          </span>
          {botStatus?.dry_run     && <span className={styles.tag} style={{ color: "var(--yellow)", borderColor: "rgba(245,158,11,.3)" }}>DRY RUN</span>}
          {botStatus?.paused_loss && <span className={styles.tag} style={{ color: "var(--red)",    borderColor: "rgba(239,68,68,.3)"   }}>LOSS LIMIT HIT</span>}
        </div>

        <div className={styles.actionGroup}>
          <button
            className={`${styles.btn} ${botStatus?.running ? styles.btnStop : styles.btnStart}`}
            onClick={handleToggleBot}
            disabled={loading === "toggle" || !botStatus}
          >
            {loading === "toggle" ? "…" : botStatus?.running ? "⏹ Stop Bot" : "▶ Start Bot"}
          </button>
          <button className={`${styles.btn} ${styles.btnWarning}`}
            onClick={() => setModal("liquidate")} disabled={loading === "liquidate"}>
            {loading === "liquidate" ? "Selling…" : "⇄ Sell All to EUR"}
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setModal("withdraw")}>
            ↑ Withdraw EUR
          </button>
          <button className={styles.reloadBtn} onClick={refresh} title="Refresh portfolio">↻</button>
        </div>
      </div>

      {/* ── Portfolio snapshot ────────────────────────────── */}
      {portfolio && (
        <div className={styles.portfolioCard}>
          <div className={styles.portfolioHeader}>
            <span className={styles.portfolioTitle}>Portfolio</span>
            <span className={styles.portfolioTotal}>
              Total&nbsp;
              <strong>{fmt(portfolio.total_eur)} €</strong>
            </span>
          </div>

          {/* Summary P&L row */}
          <div className={styles.pnlRow}>
            <div className={styles.pnlItem}>
              <span className={styles.pnlLabel}>Today&apos;s realised P&amp;L</span>
              <PnlValue value={portfolio.daily_pnl} />
            </div>
            <div className={styles.pnlItem}>
              <span className={styles.pnlLabel}>All-time realised P&amp;L</span>
              <PnlValue value={portfolio.all_time_pnl} />
            </div>
            <div className={styles.pnlItem}>
              <span className={styles.pnlLabel}>Unrealised P&amp;L</span>
              <PnlValue value={totalUnrealised || null} />
            </div>
          </div>

          {/* Asset breakdown table */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className={styles.right}>Balance</th>
                  <th className={styles.right}>Price (€)</th>
                  <th className={styles.right}>Value (€)</th>
                  <th className={styles.right}>% of wallet</th>
                  <th className={styles.right}>Unrealised P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {/* EUR row */}
                {eurBalance !== null && (
                  <tr className={styles.eurRow}>
                    <td><span className={styles.assetName}>EUR</span></td>
                    <td className={styles.right}>{fmt(eurBalance, 2)}</td>
                    <td className={styles.right}>1.00</td>
                    <td className={styles.right}><strong>{fmt(eurBalance, 2)} €</strong></td>
                    <td className={styles.right}>
                      {portfolio.total_eur > 0
                        ? `${((eurBalance / portfolio.total_eur) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className={styles.right}>—</td>
                  </tr>
                )}
                {/* Crypto rows */}
                {cryptoRows.map(([currency, b]) => (
                  <tr key={currency}>
                    <td><span className={styles.assetName}>{currency}</span></td>
                    <td className={styles.right}>{b.free.toFixed(6)}</td>
                    <td className={styles.right}>
                      {b.eur_price != null ? fmt(b.eur_price, 2) : "—"}
                    </td>
                    <td className={styles.right}>
                      {b.eur_value != null ? <strong>{fmt(b.eur_value, 2)} €</strong> : "—"}
                    </td>
                    <td className={styles.right}>
                      {b.eur_value != null && portfolio.total_eur > 0
                        ? `${((b.eur_value / portfolio.total_eur) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className={styles.right}>
                      <PnlValue value={b.unrealised_pnl_eur} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {botStatus?.paused_loss && (
            <div className={styles.lossWarning}>
              ⚠ Daily loss limit reached — auto-trading paused until midnight
            </div>
          )}
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────── */}
      {toast && (
        <div className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastErr}`}>
          {toast.msg}
        </div>
      )}

      {/* ── Liquidate confirm ───────────────────────────────── */}
      {modal === "liquidate" && (
        <div className={styles.overlay} onClick={() => setModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Sell all positions to EUR?</h3>
            <p className={styles.modalBody}>
              Places a market <strong>SELL</strong> order for every crypto asset you hold.
              Proceeds land in your Kraken EUR balance — nothing is withdrawn to your bank yet.
              {botStatus?.dry_run && <span className={styles.dryNote}> (Dry-run: no real orders)</span>}
            </p>
            <div className={styles.modalActions}>
              <button className={`${styles.btn} ${styles.btnCancel}`} onClick={() => setModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnWarning}`} onClick={handleLiquidate}>Sell all</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Withdraw modal ──────────────────────────────────── */}
      {modal === "withdraw" && (
        <div className={styles.overlay} onClick={() => setModal(null)}>
          <form className={styles.modal} onSubmit={handleWithdraw} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Withdraw EUR to bank</h3>
            <p className={styles.modalBody}>
              Withdraws to a bank account pre-registered in Kraken.
              Go to <strong>Kraken → Funding → Withdraw → EUR → Add Withdrawal Address</strong> first.
            </p>
            <label className={styles.fieldLabel}>
              Withdrawal key (bank account name in Kraken)
              <input className={styles.input} type="text" placeholder="e.g. my-bnp-account"
                value={wKey} onChange={e => setWKey(e.target.value)} required autoFocus />
            </label>
            <label className={styles.fieldLabel}>
              Amount (EUR)
              <input className={styles.input} type="number" min="1" step="0.01"
                placeholder={eurBalance != null ? `Max €${eurBalance.toFixed(2)}` : "e.g. 500"}
                value={wAmount} onChange={e => setWAmount(e.target.value)} required />
            </label>
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnCancel}`} onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={!wKey || !wAmount}>Confirm withdrawal</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
