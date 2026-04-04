"use client";

import { useState } from "react";
import { executeTrade, type AssetStatus } from "@/lib/api";
import styles from "./TradeModal.module.css";

interface Props {
  asset: AssetStatus;
  side:  "buy" | "sell";
  onClose: () => void;
  onDone:  (msg: string, isError: boolean) => void;
}

export default function TradeModal({ asset, side, onClose, onDone }: Props) {
  const [amountEur, setAmountEur] = useState("");
  const [loading, setLoading]     = useState(false);

  const isBuy     = side === "buy";
  const baseAsset = asset.symbol.split("/")[0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await executeTrade(
        asset.symbol,
        side,
        isBuy ? parseFloat(amountEur) : undefined,
      );
      const msg = result.dry_run
        ? `[Dry-run] Would ${side} ${asset.symbol}${isBuy ? ` for €${amountEur}` : ""}`
        : `Order placed! ID: ${result.order_id}`;
      onDone(msg, false);
    } catch (err) {
      onDone(err instanceof Error ? err.message : "Trade failed", true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={`${styles.title} ${isBuy ? styles.buy : styles.sell}`}>
            {isBuy ? "Buy" : "Sell"} {baseAsset}
          </h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {asset.dry_run && (
          <div className={styles.dryRunBadge}>
            Dry-run mode — no real orders will be placed
          </div>
        )}

        <div className={styles.info}>
          <span className={styles.infoLabel}>Current price</span>
          <span className={styles.infoValue}>
            €{asset.last_price?.toLocaleString("en-EU", { minimumFractionDigits: 2 }) ?? "—"}
          </span>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {isBuy ? (
            <label className={styles.label}>
              Amount to spend (EUR)
              <input
                className={styles.input}
                type="number"
                min="1"
                step="0.01"
                placeholder="e.g. 50"
                value={amountEur}
                onChange={(e) => setAmountEur(e.target.value)}
                required
                autoFocus
              />
              {amountEur && asset.last_price && (
                <span className={styles.hint}>
                  ≈ {(parseFloat(amountEur) / asset.last_price).toFixed(6)} {baseAsset}
                </span>
              )}
            </label>
          ) : (
            <p className={styles.sellNote}>
              This will sell your <strong>entire {baseAsset}</strong> balance at market price.
            </p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.confirmBtn} ${isBuy ? styles.confirmBuy : styles.confirmSell}`}
              disabled={loading || (isBuy && !amountEur)}
            >
              {loading ? "Placing order…" : `Confirm ${isBuy ? "Buy" : "Sell"}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
