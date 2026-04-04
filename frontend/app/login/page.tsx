"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError("Invalid password. Try again.");
        setLoading(false);
      }
    } catch {
      setError("Network error. Is the server running?");
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logo}>◈</div>
        <h1 className={styles.title}>CryptoBot</h1>
        <p className={styles.subtitle}>Private dashboard — sign in to continue</p>

        <input
          className={styles.input}
          type="password"
          placeholder="Dashboard password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoFocus
          required
        />

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="submit"
          className={styles.btn}
          disabled={loading || !password}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
