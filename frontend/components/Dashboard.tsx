"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStatus, type AssetStatus } from "@/lib/api";
import BotControls from "./BotControls";
import CryptoCard from "./CryptoCard";
import TradeHistory from "./TradeHistory";
import SettingsModal from "./SettingsModal";
import styles from "./Dashboard.module.css";

const POLL_INTERVAL = 3_000; // ms — matches bot tick (10 s) with buffer

export default function Dashboard() {
  const [assets, setAssets] = useState<AssetStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [countdown, setCountdown] = useState(POLL_INTERVAL / 1000);
  const [showSettings, setShowSettings] = useState(false);

  // Track previous prices to animate change direction
  const prevPrices = useRef<Record<string, number>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down">>({});

  const refresh = useCallback(async () => {
    try {
      const data = await fetchStatus();

      // Compute flash direction
      const newFlashes: Record<string, "up" | "down"> = {};
      for (const asset of data.assets) {
        if (asset.last_price === null) continue;
        const prev = prevPrices.current[asset.symbol];
        if (prev !== undefined && prev !== asset.last_price) {
          newFlashes[asset.symbol] = asset.last_price > prev ? "up" : "down";
        }
        prevPrices.current[asset.symbol] = asset.last_price;
      }

      setAssets(data.assets);
      setFlashes(newFlashes);
      setTimeout(() => setFlashes({}), 800);
      setError(null);
      setLastRefresh(new Date());
      setCountdown(POLL_INTERVAL / 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [refresh]);

  // Countdown ticker
  useEffect(() => {
    const t = setInterval(
      () => setCountdown((c) => (c > 1 ? c - 1 : POLL_INTERVAL / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [lastRefresh]);

  if (isLoading) {
    return (
      <div className={styles.centered}>
        <div className={styles.spinner} />
        <p className={styles.loadingText}>Connecting to bot…</p>
      </div>
    );
  }

  return (
    <section className={styles.section}>
      {/* Bot controls + portfolio */}
      <BotControls />

      {/* Status bar */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          {error ? (
            <span className={styles.statusError}>
              <span
                className={styles.dot}
                style={{ background: "var(--red)" }}
              />
              API unreachable
            </span>
          ) : (
            <span className={styles.statusOk}>
              <span
                className={styles.dot}
                style={{ background: "var(--green)" }}
              />
              Live · {assets.length} assets
            </span>
          )}
        </div>
        <div className={styles.statusRight}>
          {lastRefresh && (
            <span className={styles.statusMeta}>
              {lastRefresh.toLocaleTimeString()} · next in {countdown}s
            </span>
          )}
          <button
            className={styles.refreshBtn}
            onClick={refresh}
            title="Refresh now"
          >
            ↻
          </button>
          <button
            className={styles.settingsBtn}
            onClick={() => setShowSettings(true)}
            title="Bot settings"
            aria-label="Open settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Error banner */}
      {error && (
        <div className={styles.errorBanner}>
          <strong>API unreachable:</strong> {error}
        </div>
      )}

      {/* Trade history (collapsible) */}
      <div className={styles.historyWrapper}>
        <TradeHistory />
      </div>

      {/* Cards grid */}
      {assets.length > 0 ? (
        <div className={styles.grid}>
          {assets.map((asset) => (
            <CryptoCard
              key={asset.symbol}
              asset={asset}
              flash={flashes[asset.symbol] ?? null}
            />
          ))}
        </div>
      ) : (
        !error && (
          <div className={styles.centered}>
            <p className={styles.loadingText}>
              No asset data yet — bot is starting up.
            </p>
          </div>
        )
      )}
    </section>
  );
}
