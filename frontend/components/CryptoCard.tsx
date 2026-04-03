import type { AssetStatus } from "@/lib/api";
import styles from "./CryptoCard.module.css";

const SYMBOL_META: Record<string, { icon: string; color: string }> = {
  "BTC/EUR": { icon: "₿", color: "#f59e0b" },
  "ETH/EUR": { icon: "Ξ", color: "#a855f7" },
  "SOL/EUR": { icon: "◎", color: "#22c55e" },
};

function ActionBadge({ action }: { action: AssetStatus["last_action"] }) {
  const classMap: Record<string, string> = {
    HOLD: styles.badgeHold,
    SELL: styles.badgeSell,
    BUY: styles.badgeBuy,
  };
  return (
    <span className={`${styles.badge} ${classMap[action] ?? styles.badgeHold}`}>
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
          style={{ left: `${Math.min(100, Math.max(0, rsi))}%`, background: color }}
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

export default function CryptoCard({ asset }: { asset: AssetStatus }) {
  const meta = SYMBOL_META[asset.symbol] ?? { icon: "○", color: "var(--blue)" };
  const [base] = asset.symbol.split("/");

  const priceDrop =
    asset.highest && asset.last_price
      ? ((asset.highest - asset.last_price) / asset.highest) * 100
      : null;

  return (
    <article className={`${styles.card} ${asset.error ? styles.cardError : ""}`}>
      {/* Card header */}
      <div className={styles.cardHeader}>
        <div className={styles.symbolGroup}>
          <span className={styles.icon} style={{ color: meta.color }}>
            {meta.icon}
          </span>
          <div>
            <div className={styles.symbolName}>{base}</div>
            <div className={styles.pairLabel}>{asset.symbol}</div>
          </div>
        </div>
        <ActionBadge action={asset.last_action} />
      </div>

      {/* Error state */}
      {asset.error && (
        <div className={styles.errorMsg}>
          <span>⚠</span> {asset.error}
        </div>
      )}

      {/* Prices */}
      <div className={styles.priceRow}>
        <div className={styles.priceItem}>
          <div className={styles.label}>Price</div>
          <div className={styles.priceValue}>
            €{fmt(asset.last_price, asset.symbol === "BTC/EUR" ? 0 : 2)}
          </div>
        </div>
        <div className={styles.priceItem}>
          <div className={styles.label}>All-time high (session)</div>
          <div className={styles.priceValue} style={{ color: "var(--yellow)" }}>
            €{fmt(asset.highest, asset.symbol === "BTC/EUR" ? 0 : 2)}
          </div>
        </div>
      </div>

      {/* Drop from high */}
      {priceDrop !== null && (
        <div className={styles.dropRow}>
          <span className={styles.label}>Drop from high</span>
          <span
            style={{
              color: priceDrop >= 3 ? "var(--red)" : "var(--text-muted)",
              fontWeight: 500,
              fontSize: "0.875rem",
            }}
          >
            {priceDrop.toFixed(2)}%
            {priceDrop >= 3 && " — stop triggered"}
          </span>
        </div>
      )}

      {/* RSI */}
      <div className={styles.rsiRow}>
        <span className={styles.label}>RSI (14)</span>
        <RsiBar rsi={asset.rsi} />
      </div>

      {/* Timestamp */}
      {asset.last_updated && (
        <div className={styles.timestamp}>
          Updated {new Date(asset.last_updated).toLocaleTimeString()}
        </div>
      )}
    </article>
  );
}
