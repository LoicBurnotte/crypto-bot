"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BotConfig, ProfileName, Profiles,
  fetchConfig, fetchProfiles, updateConfig, resetConfig,
} from "@/lib/api";
import styles from "./SettingsModal.module.css";

// ── Available trading pairs ───────────────────────────────────────────────────
const ALL_SYMBOLS = [
  "BTC/EUR", "ETH/EUR", "SOL/EUR", "XRP/EUR",
  "ADA/EUR", "DOT/EUR", "LINK/EUR", "MATIC/EUR",
  "AVAX/EUR", "ATOM/EUR", "LTC/EUR", "BCH/EUR",
];

// ── Profile meta ──────────────────────────────────────────────────────────────
const PROFILE_META: Record<ProfileName, { label: string; color: string; desc: string }> = {
  conservative: { label: "Conservative", color: "#22c55e", desc: "Low risk · small trades · tight stops" },
  moderate:     { label: "Moderate",     color: "#3b82f6", desc: "Balanced risk · default settings"      },
  aggressive:   { label: "Aggressive",   color: "#ef4444", desc: "Higher risk · bigger trades"           },
  custom:       { label: "Custom",       color: "#a855f7", desc: "Your own configuration"                },
};

// ── Tooltip component ─────────────────────────────────────────────────────────
function Tip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className={styles.tipWrap}>
      <button
        type="button"
        className={styles.tipIcon}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-label="More information"
      >?</button>
      {show && <span className={styles.tipBox} role="tooltip">{text}</span>}
    </span>
  );
}

// ── Field wrappers ────────────────────────────────────────────────────────────
function Field({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label} <Tip text={tip} />
      </label>
      {children}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
interface Props { onClose: () => void }

export default function SettingsModal({ onClose }: Props) {
  const [config, setConfig]     = useState<BotConfig | null>(null);
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [form, setForm]         = useState<Partial<BotConfig>>({});
  const [profile, setProfile]   = useState<ProfileName>("custom");
  const [saving, setSaving]     = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast]       = useState<{ msg: string; error: boolean } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const [cfg, profs] = await Promise.all([fetchConfig(), fetchProfiles()]);
      setConfig(cfg);
      setProfiles(profs);
      setForm(cfg);
    } catch {
      showToast("Failed to load config", true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close on overlay click
  const handleOverlay = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const set = (key: keyof BotConfig, value: unknown) =>
    setForm(f => ({ ...f, [key]: value }));

  const toggleSymbol = (sym: string) => {
    const current = (form.symbols ?? config?.symbols ?? []) as string[];
    const next = current.includes(sym)
      ? current.filter(s => s !== sym)
      : [...current, sym];
    set("symbols", next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateConfig(form);
      setConfig(updated);
      setForm(updated);
      showToast("Configuration saved");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Save failed", true);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (p: ProfileName) => {
    setResetting(true);
    try {
      const updated = await resetConfig(p);
      setConfig(updated);
      setForm(updated);
      setProfile(p);
      showToast(`Reset to ${PROFILE_META[p].label} profile`);
    } catch {
      showToast("Reset failed", true);
    } finally {
      setResetting(false);
    }
  };

  const applyProfile = (p: ProfileName) => {
    if (!profiles) return;
    setProfile(p);
    if (p !== "custom") {
      setForm(f => ({ ...f, ...profiles[p] }));
    }
  };

  const selectedSymbols = (form.symbols ?? config?.symbols ?? []) as string[];
  const isLoading = !config;

  return (
    <div className={styles.overlay} ref={overlayRef} onClick={handleOverlay}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Bot Settings">
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Bot Settings</h2>
            <p className={styles.subtitle}>Changes apply on the next tick — no restart needed</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {isLoading ? (
          <div className={styles.loading}>Loading configuration…</div>
        ) : (
          <>
            {/* Profile selector */}
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Profile</h3>
              <div className={styles.profiles}>
                {(Object.keys(PROFILE_META) as ProfileName[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    className={[styles.profileBtn, profile === p ? styles.profileActive : ""].join(" ")}
                    style={{ "--profile-color": PROFILE_META[p].color } as React.CSSProperties}
                    onClick={() => applyProfile(p)}
                  >
                    <span className={styles.profileLabel}>{PROFILE_META[p].label}</span>
                    <span className={styles.profileDesc}>{PROFILE_META[p].desc}</span>
                  </button>
                ))}
              </div>
              {profile !== "custom" && (
                <button
                  className={styles.resetBtn}
                  disabled={resetting}
                  onClick={() => handleReset(profile)}
                >
                  {resetting ? "Resetting…" : `↺ Reset to ${PROFILE_META[profile].label} defaults`}
                </button>
              )}
            </div>

            <div className={styles.body}>
              {/* Trading pairs */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  Trading Pairs
                  <Tip text="Which cryptocurrencies the bot will monitor and trade. Fewer pairs = more focused. Each pair needs enough EUR balance." />
                </h3>
                <div className={styles.symbolGrid}>
                  {ALL_SYMBOLS.map(sym => (
                    <button
                      key={sym}
                      type="button"
                      className={[styles.symChip, selectedSymbols.includes(sym) ? styles.symActive : ""].join(" ")}
                      onClick={() => { toggleSymbol(sym); setProfile("custom"); }}
                    >
                      {sym.split("/")[0]}
                    </button>
                  ))}
                </div>
                <p className={styles.hint}>{selectedSymbols.length} pair{selectedSymbols.length !== 1 ? "s" : ""} selected · max exposure €{((form.trade_amount_eur ?? 0) * selectedSymbols.length).toFixed(0)}</p>
              </div>

              {/* Trading */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Trading</h3>
                <div className={styles.grid2}>
                  <Field label="Trade amount (€)" tip="EUR spent per buy order. Set to 0 for dry-run (simulation only — no real orders placed).">
                    <input type="number" min="0" step="1" className={styles.input}
                      value={form.trade_amount_eur ?? ""}
                      onChange={e => { set("trade_amount_eur", parseFloat(e.target.value)); setProfile("custom"); }} />
                    {(form.trade_amount_eur ?? 0) <= 0 && <span className={styles.badge}>Dry run</span>}
                  </Field>
                  <Field label="Max daily loss (€)" tip="Bot pauses auto-trading for the day once realised losses exceed this. Set to 0 to disable the safety limit.">
                    <input type="number" min="0" step="1" className={styles.input}
                      value={form.max_daily_loss_eur ?? ""}
                      onChange={e => { set("max_daily_loss_eur", parseFloat(e.target.value)); setProfile("custom"); }} />
                  </Field>
                  <Field label="Trailing stop (%)" tip="Sell if price drops this % from its session peak. E.g. 3% means sell when price is 3% below the highest point since the last buy.">
                    <input type="number" min="0.5" max="20" step="0.5" className={styles.input}
                      value={((form.trailing_stop_pct ?? 0.03) * 100).toFixed(1)}
                      onChange={e => { set("trailing_stop_pct", parseFloat(e.target.value) / 100); setProfile("custom"); }} />
                  </Field>
                  <Field label="Take profit (%)" tip="Sell if price rises this % above entry price. Locks in gains automatically.">
                    <input type="number" min="0.5" max="50" step="0.5" className={styles.input}
                      value={((form.take_profit_pct ?? 0.05) * 100).toFixed(1)}
                      onChange={e => { set("take_profit_pct", parseFloat(e.target.value) / 100); setProfile("custom"); }} />
                  </Field>
                </div>
              </div>

              {/* RSI */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>RSI Indicator</h3>
                <div className={styles.grid2}>
                  <Field label="RSI period" tip="Number of candles used to calculate RSI. Standard is 14. Higher = smoother but slower signal.">
                    <input type="number" min="5" max="50" step="1" className={styles.input}
                      value={form.rsi_period ?? 14}
                      onChange={e => { set("rsi_period", parseInt(e.target.value)); setProfile("custom"); }} />
                  </Field>
                  <Field label="Timeframe" tip="Candle size for RSI/EMA calculation. 1h = responds in hours, 4h = days, 1d = weeks. Independent of the 10s live price loop.">
                    <select className={styles.input}
                      value={form.rsi_timeframe ?? "1h"}
                      onChange={e => { set("rsi_timeframe", e.target.value); setProfile("custom"); }}>
                      <option value="1h">1 hour — short-term (~14h lookback)</option>
                      <option value="4h">4 hours — medium-term (~2.5d lookback)</option>
                      <option value="1d">1 day — long-term (~14d lookback)</option>
                    </select>
                  </Field>
                  <Field label="Oversold threshold" tip="RSI below this level triggers a potential buy signal (combined with EMA). Default 30. Lower = rarer, safer entries.">
                    <input type="number" min="10" max="45" step="1" className={styles.input}
                      value={form.rsi_oversold ?? 30}
                      onChange={e => { set("rsi_oversold", parseFloat(e.target.value)); setProfile("custom"); }} />
                  </Field>
                  <Field label="Overbought threshold" tip="RSI above this triggers a sell signal. Also used as the target for Hold-until-overbought mode. Default 70.">
                    <input type="number" min="55" max="90" step="1" className={styles.input}
                      value={form.rsi_overbought ?? 70}
                      onChange={e => { set("rsi_overbought", parseFloat(e.target.value)); setProfile("custom"); }} />
                  </Field>
                </div>
              </div>

              {/* EMA */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>EMA Crossover</h3>
                <div className={styles.grid2}>
                  <Field label="Fast EMA period" tip="Short-term moving average. When fast EMA crosses above slow EMA it confirms bullish momentum and enables buy signals. Default 9.">
                    <input type="number" min="3" max="50" step="1" className={styles.input}
                      value={form.ema_fast ?? 9}
                      onChange={e => { set("ema_fast", parseInt(e.target.value)); setProfile("custom"); }} />
                  </Field>
                  <Field label="Slow EMA period" tip="Long-term moving average used for trend direction. Default 21. Must be greater than Fast EMA.">
                    <input type="number" min="5" max="200" step="1" className={styles.input}
                      value={form.ema_slow ?? 21}
                      onChange={e => { set("ema_slow", parseInt(e.target.value)); setProfile("custom"); }} />
                  </Field>
                </div>
              </div>

              {/* Notifications */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Notifications</h3>
                <Field label="Webhook URL" tip="Optional Discord or Slack webhook. The bot posts a message on every buy/sell. Leave empty to disable.">
                  <input type="url" className={styles.input} placeholder="https://discord.com/api/webhooks/…"
                    value={form.webhook_url ?? ""}
                    onChange={e => set("webhook_url", e.target.value)} />
                </Field>
              </div>

              {/* Credentials */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  Kraken API Credentials
                  <span className={styles.encBadge}>🔒 Encrypted at rest</span>
                </h3>
                <p className={styles.hint}>
                  Stored encrypted in <code>bot_config.json</code> using your <code>AUTH_SECRET</code> as key.
                  Leave fields blank to keep existing values.
                </p>
                <div className={styles.grid2}>
                  <Field label="API Key" tip="Found in Kraken → Security → API. Needs: Query Funds + Create Orders permissions.">
                    <input type="text" className={styles.input} placeholder="Current key kept if blank"
                      value={form.kraken_api_key === "••••" ? "" : (form.kraken_api_key ?? "")}
                      onChange={e => set("kraken_api_key", e.target.value)} />
                  </Field>
                  <Field label="API Secret" tip="The private secret paired with your API key. Never share this. Stored encrypted.">
                    <div className={styles.secretWrap}>
                      <input
                        type={showSecret ? "text" : "password"}
                        className={styles.input}
                        placeholder="Current secret kept if blank"
                        value={form.kraken_api_secret === "••••" ? "" : (form.kraken_api_secret ?? "")}
                        onChange={e => set("kraken_api_secret", e.target.value)}
                      />
                      <button type="button" className={styles.eyeBtn}
                        onClick={() => setShowSecret(s => !s)}
                        aria-label={showSecret ? "Hide secret" : "Show secret"}>
                        {showSecret ? "🙈" : "👁"}
                      </button>
                    </div>
                  </Field>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={styles.footer}>
              <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button className={styles.saveBtn} disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}

        {/* Toast */}
        {toast && (
          <div className={[styles.toast, toast.error ? styles.toastError : styles.toastOk].join(" ")}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}
