"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchStatus, type AssetStatus } from "@/lib/api";
import CryptoCard from "./CryptoCard";
import styles from "./Dashboard.module.css";

const REFRESH_INTERVAL_MS = 5000;

export default function Dashboard() {
  const [assets, setAssets] = useState<AssetStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchStatus();
      setAssets(data.assets);
      setError(null);
      setLastRefresh(new Date());
      setCountdown(REFRESH_INTERVAL_MS / 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh every 5 s
  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Countdown ticker
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((c) => (c > 1 ? c - 1 : REFRESH_INTERVAL_MS / 1000));
    }, 1000);
    return () => clearInterval(tick);
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
      {/* Status bar */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          {error ? (
            <span className={styles.statusError}>
              <span className={styles.dot} style={{ background: "var(--red)" }} />
              Connection error
            </span>
          ) : (
            <span className={styles.statusOk}>
              <span className={styles.dot} style={{ background: "var(--green)" }} />
              Live
            </span>
          )}
        </div>
        <div className={styles.statusRight}>
          {lastRefresh && (
            <span className={styles.statusMeta}>
              Last update: {lastRefresh.toLocaleTimeString()} · refreshing in {countdown}s
            </span>
          )}
          <button className={styles.refreshBtn} onClick={refresh} title="Refresh now">
            ↻
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className={styles.errorBanner}>
          <strong>API unreachable:</strong> {error}
        </div>
      )}

      {/* Cards grid */}
      {assets.length > 0 ? (
        <div className={styles.grid}>
          {assets.map((asset) => (
            <CryptoCard key={asset.symbol} asset={asset} />
          ))}
        </div>
      ) : (
        !error && (
          <div className={styles.centered}>
            <p className={styles.loadingText}>No asset data yet — bot is starting up.</p>
          </div>
        )
      )}
    </section>
  );
}
