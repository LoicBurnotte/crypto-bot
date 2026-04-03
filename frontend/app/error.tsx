"use client";

import { useEffect } from "react";
import styles from "./page.module.css";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className={styles.errorBoundary}>
      <div className={styles.errorCard}>
        <h2 className={styles.errorTitle}>Something went wrong</h2>
        <p className={styles.errorMessage}>{error.message}</p>
        <button className={styles.retryButton} onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
