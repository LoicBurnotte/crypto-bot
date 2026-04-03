import Dashboard from "@/components/Dashboard";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>◈</span>
            <span className={styles.logoText}>CryptoBot</span>
          </div>
          <p className={styles.headerSub}>Live trading dashboard</p>
        </div>
      </header>
      <Dashboard />
    </main>
  );
}
