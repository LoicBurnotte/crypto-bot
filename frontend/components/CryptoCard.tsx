"use client";

import { useState, lazy, Suspense } from "react";
import type { AssetStatus } from "@/lib/api";
import { setHoldUntilOverbought, setSymbolDisabled } from "@/lib/api";
import { scoreLabel } from "@/lib/opportunity";
import TradeModal from "./TradeModal";
import styles from "./CryptoCard.module.css";

const PriceChart = lazy(() => import("./PriceChart"));

const SYMBOL_META: Record<string, { icon: string; color: string }> = {
  "BTC/EUR":   { icon: "₿",  color: "#f59e0b" },
  "ETH/EUR":   { icon: "Ξ",  color: "#a855f7" },
  "SOL/EUR":   { icon: "◎",  color: "#22c55e" },
  "XRP/EUR":   { icon: "✕",  color: "#3b82f6" },
  "ADA/EUR":   { icon: "₳",  color: "#06b6d4" },
  "DOT/EUR":   { icon: "●",  color: "#ec4899" },
  "LINK/EUR":  { icon: "⬡",  color: "#2563eb" },
  "AVAX/EUR":  { icon: "▲",  color: "#ef4444" },
  "ATOM/EUR":  { icon: "⬤",  color: "#6366f1" },
  "MATIC/EUR": { icon: "⬟",  color: "#8b5cf6" },
  "LTC/EUR":   { icon: "Ł",  color: "#94a3b8" },
  "BCH/EUR":   { icon: "Ƀ",  color: "#16a34a" },
  "NEAR/EUR":  { icon: "Ⓝ",  color: "#0ea5e9" },
  "UNI/EUR":   { icon: "⚗",  color: "#f472b6" },
  "DOGE/EUR":  { icon: "Ð",  color: "#ca8a04" },
  "ALGO/EUR":  { icon: "◈",  color: "#14b8a6" },
  "FIL/EUR":   { icon: "⬡",  color: "#64748b" },
};

function ActionBadge({ action }: { action: AssetStatus["last_action"] }) {
  const cls: Record<string, string> = {
    HOLD: styles.badgeHold,
    SELL: styles.badgeSell,
    BUY: styles.badgeBuy,
  };
  return (
    <span className={`${styles.badge} ${cls[action] ?? styles.badgeHold}`}>
      {action}
    </span>
  );
}

function RsiBar({ rsi }: { rsi: number | null }) {
  if (rsi === null) return <span className={styles.muted}>—</span>;
  let color = "var(--text-muted)";
  if (rsi < 30) color = "var(--green)";
  else if (rsi > 70) color = "var(--red)";
  return (
    <div className={styles.rsiWrapper}>
      <div className={styles.rsiTrack}>
        <div
          className={styles.rsiThumb}
          style={{
            left: `${Math.min(100, Math.max(0, rsi))}%`,
            background: color,
          }}
        />
      </div>
      <span style={{ color, fontWeight: 600, fontSize: "0.85rem" }}>
        {rsi.toFixed(1)}
      </span>
    </div>
  );
}

function fmt(value: number | null, decimals = 2): string {
  if (value === null) return "—";
  return value.toLocaleString("en-EU", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function CryptoCard({
  asset,
  flash,
  score = 0,
}: {
  asset: AssetStatus;
  flash: "up" | "down" | null;
  score?: number;
}) {
  const [modal, setModal] = useState<"buy" | "sell" | null>(null);
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const [showChart, setShowChart] = useState(false);
  const [holdLoading, setHoldLoading] = useState(false);
  const [disableLoading, setDisableLoading] = useState(false);

  const meta = SYMBOL_META[asset.symbol] ?? { icon: "○", color: "var(--blue)" };
  const [base] = asset.symbol.split("/");
  const decimals = asset.symbol === "BTC/EUR" ? 0 : 2;

  function showToast(msg: string, isError: boolean) {
    setModal(null);
    setToast({ msg, error: isError });
    setTimeout(() => setToast(null), 4000);
  }

  const emaCross =
    asset.ema_fast !== null && asset.ema_slow !== null
      ? asset.ema_fast > asset.ema_slow
        ? "bullish"
        : "bearish"
      : null;

  return (
    <>
      <article
        className={[
          styles.card,
          asset.error ? styles.cardError : "",
          asset.disabled ? styles.cardDisabled : "",
          flash === "up" ? styles.flashUp : "",
          flash === "down" ? styles.flashDown : "",
        ].join(" ")}
      >
        {/* Header */}
        <div className={styles.cardHeader}>
          <div className={styles.symbolGroup}>
            <span className={styles.icon} style={{ color: meta.color, opacity: asset.disabled ? 0.4 : 1 }}>
              {meta.icon}
            </span>
            <div>
              <div className={styles.symbolName} style={{ opacity: asset.disabled ? 0.5 : 1 }}>{base}</div>
              <div className={styles.pairLabel}>{asset.symbol}</div>
            </div>
          </div>
          <div className={styles.headerRight}>
            {/* Opportunity score badge */}
            {!asset.disabled && score > 0 && (() => {
              const lbl = scoreLabel(score);
              return (
                <span
                  className={styles.scoreBadge}
                  style={{ color: lbl.color, borderColor: lbl.color + "55", background: lbl.color + "18" }}
                  title={`Opportunity score: ${score}/100`}
                >
                  🎯{score}
                </span>
              );
            })()}
            {!asset.disabled && <ActionBadge action={asset.last_action} />}
            {asset.disabled  && <span className={styles.disabledBadge}>Paused</span>}
            <button
              className={`${styles.disableBtn} ${asset.disabled ? styles.disableBtnOff : ""}`}
              disabled={disableLoading}
              title={asset.disabled ? "Resume this symbol" : "Pause this symbol"}
              onClick={async () => {
                setDisableLoading(true);
                try {
                  await setSymbolDisabled(asset.symbol, !asset.disabled);
                  showToast(asset.disabled ? `${base} resumed` : `${base} paused`, false);
                } catch (e) {
                  showToast(e instanceof Error ? e.message : "Failed", true);
                } finally { setDisableLoading(false); }
              }}
            >
              {disableLoading ? "…" : asset.disabled ? "▶" : "⏸"}
            </button>
          </div>
        </div>

        {/* Error */}
        {asset.error && <div className={styles.errorMsg}>⚠ {asset.error}</div>}

        {/* Prices */}
        <div className={styles.priceRow}>
          <div className={styles.priceItem}>
            <div className={styles.label}>Price</div>
            <div className={styles.priceValue}>
              €{fmt(asset.last_price, decimals)}
            </div>
          </div>
          <div className={styles.priceItem}>
            <div className={styles.label}>Session high</div>
            <div
              className={styles.priceValue}
              style={{ color: "var(--yellow)" }}
            >
              €{fmt(asset.highest, decimals)}
            </div>
          </div>
        </div>

        {/* Drop from high */}
        {asset.drop_pct !== null && (
          <div className={styles.dropRow}>
            <span className={styles.label}>Drop from high</span>
            <span
              style={{
                color:
                  (asset.drop_pct ?? 0) >= 3
                    ? "var(--red)"
                    : "var(--text-muted)",
                fontWeight: 500,
                fontSize: "0.875rem",
              }}
            >
              {asset.drop_pct?.toFixed(2)}%
              {(asset.drop_pct ?? 0) >= 3 && " · stop triggered"}
            </span>
          </div>
        )}

        {/* RSI */}
        <div className={styles.rsiRow}>
          <span className={styles.label}>RSI (14)</span>
          <RsiBar rsi={asset.rsi} />
        </div>

        {/* EMA crossover */}
        {emaCross && (
          <div className={styles.emaRow}>
            <span className={styles.label}>EMA {`(${9}/${21})`}</span>
            <span
              className={`${styles.emaBadge} ${emaCross === "bullish" ? styles.emaBull : styles.emaBear}`}
            >
              {emaCross === "bullish" ? "▲ Bullish" : "▼ Bearish"}
            </span>
          </div>
        )}

        {/* Unrealised P&L */}
        {asset.unrealised_pnl_pct !== null && asset.last_action === "BUY" && (
          <div className={styles.dropRow}>
            <span className={styles.label}>Unrealised P&amp;L</span>
            <span
              style={{
                color:
                  (asset.unrealised_pnl_pct ?? 0) >= 0
                    ? "var(--green)"
                    : "var(--red)",
                fontWeight: 600,
                fontSize: "0.875rem",
              }}
            >
              {asset.unrealised_pnl_pct >= 0 ? "+" : ""}
              {asset.unrealised_pnl_pct.toFixed(2)}%
            </span>
          </div>
        )}

        {/* CTA buttons */}
        <div className={styles.ctaRow}>
          <button
            className={`${styles.ctaBtn} ${styles.ctaBuy}`}
            onClick={() => setModal("buy")}
            disabled={!asset.last_price}
          >
            Buy {base}
          </button>
          <button
            className={`${styles.ctaBtn} ${styles.ctaSell}`}
            onClick={() => setModal("sell")}
            disabled={!asset.last_price}
          >
            Sell {base}
          </button>
        </div>

        {/* Hold until RSI overbought toggle */}
        <div
          className={`${styles.holdRow} ${asset.hold_until_overbought ? styles.holdActive : ""}`}
        >
          <div className={styles.holdInfo}>
            <span className={styles.holdLabel}>
              {asset.hold_until_overbought
                ? `⏳ Holding — waiting for RSI ≥ ${asset.rsi_overbought_target}`
                : "Hold until RSI overbought"}
            </span>
            {asset.hold_until_overbought && asset.rsi !== null && (
              <div className={styles.rsiProgress}>
                <div className={styles.rsiProgressTrack}>
                  <div
                    className={styles.rsiProgressFill}
                    style={{
                      width: `${Math.min(100, (asset.rsi / asset.rsi_overbought_target) * 100)}%`,
                    }}
                  />
                </div>
                <span className={styles.rsiProgressLabel}>
                  {asset.rsi.toFixed(1)} / {asset.rsi_overbought_target}
                </span>
              </div>
            )}
          </div>
          <button
            className={`${styles.holdBtn} ${asset.hold_until_overbought ? styles.holdBtnActive : ""}`}
            disabled={holdLoading}
            onClick={async () => {
              setHoldLoading(true);
              try {
                await setHoldUntilOverbought(
                  asset.symbol,
                  !asset.hold_until_overbought,
                );
                showToast(
                  asset.hold_until_overbought
                    ? `Hold mode OFF for ${base}`
                    : `Hold mode ON — will sell ${base} at RSI ≥ ${asset.rsi_overbought_target}`,
                  false,
                );
              } catch (e) {
                showToast(e instanceof Error ? e.message : "Failed", true);
              } finally {
                setHoldLoading(false);
              }
            }}
          >
            {holdLoading
              ? "…"
              : asset.hold_until_overbought
                ? "Cancel"
                : "Enable"}
          </button>
        </div>

        {/* Chart toggle */}
        <button
          className={styles.chartToggle}
          onClick={() => setShowChart((s) => !s)}
        >
          {showChart ? "▲ Hide chart" : "▼ Show chart"}
        </button>

        {showChart && (
          <Suspense
            fallback={<div className={styles.chartLoading}>Loading chart…</div>}
          >
            <PriceChart symbol={asset.symbol} />
          </Suspense>
        )}

        {/* Dry-run indicator */}
        {asset.dry_run && (
          <div className={styles.dryRunNote}>
            Dry-run mode · orders are simulated
          </div>
        )}

        {/* Timestamp */}
        {asset.last_updated && (
          <div className={styles.timestamp}>
            Updated {new Date(asset.last_updated).toLocaleTimeString()}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            className={`${styles.toast} ${toast.error ? styles.toastError : styles.toastOk}`}
          >
            {toast.msg}
          </div>
        )}
      </article>

      {/* Trade modal */}
      {modal && (
        <TradeModal
          asset={asset}
          side={modal}
          onClose={() => setModal(null)}
          onDone={showToast}
        />
      )}
    </>
  );
}
