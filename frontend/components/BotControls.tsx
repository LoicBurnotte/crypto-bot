"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchBotStatus, fetchPortfolio,
  startBot, stopBot, liquidateAll, withdrawEur,
  type BotStatus, type Portfolio,
} from "@/lib/api";
import styles from "./BotControls.module.css";

type ModalType = "liquidate" | "withdraw" | null;

export default function BotControls() {
  const [botStatus,  setBotStatus]  = useState<BotStatus | null>(null);
  const [portfolio,  setPortfolio]  = useState<Portfolio | null>(null);
  const [modal,      setModal]      = useState<ModalType>(null);
  const [loading,    setLoading]    = useState<string | null>(null);  // action key
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);

  // Withdraw form state
  const [wAmount, setWAmount] = useState("");
  const [wKey,    setWKey]    = useState("");

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  };

  const refresh = useCallback(async () => {
    try {
      const [bs, pf] = await Promise.all([fetchBotStatus(), fetchPortfolio()]);
      setBotStatus(bs);
      setPortfolio(pf);
    } catch {
      /* silently ignore — API may not have keys configured */
    }
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
    } finally {
      setLoading(null);
    }
  }

  async function handleLiquidate() {
    setLoading("liquidate");
    setModal(null);
    try {
      const res = await liquidateAll();
      const ok  = res.results.every(r => r.ok);
      const dryRun = res.results[0]?.dry_run;
      showToast(
        dryRun
          ? "[Dry-run] Would sell all positions to EUR"
          : ok
          ? `All positions sold to EUR`
          : "Some orders failed — check logs",
        ok,
      );
      refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Liquidation failed", false);
    } finally {
      setLoading(null);
    }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setLoading("withdraw");
    setModal(null);
    try {
      await withdrawEur(parseFloat(wAmount), wKey);
      showToast(`Withdrawal of €${wAmount} initiated`, true);
      setWAmount("");
      setWKey("");
      refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Withdrawal failed", false);
    } finally {
      setLoading(null);
    }
  }

  const eurBalance = portfolio?.balances?.["EUR"]?.free ?? null;
  const cryptoBalances = portfolio
    ? Object.entries(portfolio.balances).filter(([c]) => c !== "EUR" && c !== "ZEUR")
    : [];

  return (
    <div className={styles.wrapper}>
      {/* ── Bot status bar ─────────────────────────────────── */}
      <div className={styles.controlBar}>
        <div className={styles.statusGroup}>
          <span
            className={styles.dot}
            style={{ background: botStatus?.running ? "var(--green)" : "var(--red)" }}
          />
          <span className={styles.statusLabel}>
            {botStatus
              ? botStatus.running ? "Bot running" : "Bot stopped"
              : "Connecting…"}
          </span>
          {botStatus?.dry_run && (
            <span className={styles.dryRunTag}>DRY RUN</span>
          )}
        </div>

        <div className={styles.actionGroup}>
          <button
            className={`${styles.btn} ${botStatus?.running ? styles.btnStop : styles.btnStart}`}
            onClick={handleToggleBot}
            disabled={loading === "toggle" || !botStatus}
          >
            {loading === "toggle"
              ? "…"
              : botStatus?.running ? "⏹ Stop Bot" : "▶ Start Bot"}
          </button>

          <button
            className={`${styles.btn} ${styles.btnWarning}`}
            onClick={() => setModal("liquidate")}
            disabled={loading === "liquidate"}
          >
            {loading === "liquidate" ? "Selling…" : "⇄ Sell All to EUR"}
          </button>

          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setModal("withdraw")}
          >
            ↑ Withdraw EUR
          </button>
        </div>
      </div>

      {/* ── Portfolio ──────────────────────────────────────── */}
      {portfolio && (
        <div className={styles.portfolio}>
          <div className={styles.portfolioItem}>
            <span className={styles.portfolioLabel}>EUR Balance</span>
            <span className={styles.portfolioValue}>
              €{eurBalance !== null ? eurBalance.toLocaleString("en-EU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </span>
          </div>
          {cryptoBalances.map(([currency, info]) => (
            <div key={currency} className={styles.portfolioItem}>
              <span className={styles.portfolioLabel}>{currency}</span>
              <span className={styles.portfolioValue}>
                {info.free.toFixed(6)}
                {info.used > 0 && (
                  <span className={styles.portfolioUsed}> (+{info.used.toFixed(6)} locked)</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────── */}
      {toast && (
        <div className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastErr}`}>
          {toast.msg}
        </div>
      )}

      {/* ── Liquidate confirm modal ─────────────────────────── */}
      {modal === "liquidate" && (
        <div className={styles.overlay} onClick={() => setModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Sell all positions to EUR?</h3>
            <p className={styles.modalBody}>
              This will place market <strong>SELL</strong> orders for every crypto asset
              you hold. The proceeds will remain in your Kraken EUR balance.
              {botStatus?.dry_run && (
                <span className={styles.dryRunNote}> (Dry-run: no real orders)</span>
              )}
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
              Withdraws to a bank account you have pre-registered in Kraken.
              Go to <strong>Kraken → Funding → Withdraw → EUR → Add Withdrawal Address</strong> first,
              then enter the name you gave it below.
            </p>

            <label className={styles.fieldLabel}>
              Withdrawal key (bank account name in Kraken)
              <input
                className={styles.input}
                type="text"
                placeholder="e.g. my-bnp-account"
                value={wKey}
                onChange={e => setWKey(e.target.value)}
                required
                autoFocus
              />
            </label>

            <label className={styles.fieldLabel}>
              Amount (EUR)
              <input
                className={styles.input}
                type="number"
                min="1"
                step="0.01"
                placeholder={eurBalance !== null ? `Max €${eurBalance.toFixed(2)}` : "e.g. 500"}
                value={wAmount}
                onChange={e => setWAmount(e.target.value)}
                required
              />
            </label>

            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnCancel}`} onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!wKey || !wAmount}>
                Confirm withdrawal
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
