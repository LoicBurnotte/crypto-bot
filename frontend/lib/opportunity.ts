import type { AssetStatus } from "./api";

/**
 * Composite opportunity score (0–100).
 *
 * Higher = stronger buy signal approaching or already triggered.
 * Designed to surface assets worth watching RIGHT NOW.
 *
 * Components:
 *  RSI proximity to oversold   → 0–40 pts
 *  EMA bullish crossover        → 0–20 pts
 *  Drop from session peak       → 0–20 pts
 *  Position state (SELL = ready)→ 0–20 pts
 */
export function opportunityScore(a: AssetStatus): number {
  if (a.disabled || a.error) return 0;

  let score = 0;

  // ── RSI (40 pts max) ────────────────────────────────────────────────────────
  if (a.rsi !== null) {
    if      (a.rsi < 25) score += 40;   // deeply oversold — prime entry
    else if (a.rsi < 30) score += 34;   // oversold
    else if (a.rsi < 35) score += 24;   // approaching oversold
    else if (a.rsi < 40) score += 14;   // warming up
    else if (a.rsi < 50) score +=  6;   // neutral zone
    else if (a.rsi > 70) score -= 15;   // overbought — avoid
  }

  // ── EMA crossover (20 pts max) ──────────────────────────────────────────────
  if (a.ema_fast !== null && a.ema_slow !== null) {
    if (a.ema_fast > a.ema_slow) score += 20;
  }

  // ── Drop from peak (20 pts max) — deeper dip = more potential rebound ───────
  if (a.drop_pct !== null) {
    if      (a.drop_pct > 8)  score += 20;
    else if (a.drop_pct > 5)  score += 15;
    else if (a.drop_pct > 2)  score += 8;
    else if (a.drop_pct > 0.5) score += 3;
  }

  // ── Position state (20 pts max) ─────────────────────────────────────────────
  if (a.last_action === "SELL") score += 20;  // bot sold → ready to re-enter
  if (a.last_action === "BUY")  score -=  5;  // already holding

  return Math.max(0, Math.min(100, score));
}

/** Human-readable label + colour for a score. */
export function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 75) return { label: "Hot",    color: "#22c55e" };
  if (score >= 55) return { label: "Watch",  color: "#3b82f6" };
  if (score >= 35) return { label: "Neutral",color: "#6b7280" };
  return               { label: "Low",    color: "#374151" };
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

export type SortKey =
  | "opportunity"   // score desc
  | "rsi"           // ascending (most oversold first)
  | "drop"          // drop_pct desc
  | "pnl"           // unrealised P&L desc
  | "symbol";       // A→Z

export type FilterKey = "all" | "opportunity" | "buying" | "holding" | "selling";

export function sortAssets(
  assets:  AssetStatus[],
  sortKey: SortKey,
): AssetStatus[] {
  const scores = new Map(assets.map(a => [a.symbol, opportunityScore(a)]));
  return [...assets].sort((a, b) => {
    switch (sortKey) {
      case "opportunity":
        return (scores.get(b.symbol) ?? 0) - (scores.get(a.symbol) ?? 0);
      case "rsi":
        return (a.rsi ?? 999) - (b.rsi ?? 999);
      case "drop":
        return (b.drop_pct ?? 0) - (a.drop_pct ?? 0);
      case "pnl":
        return (b.unrealised_pnl_pct ?? -999) - (a.unrealised_pnl_pct ?? -999);
      case "symbol":
        return a.symbol.localeCompare(b.symbol);
    }
  });
}

export function filterAssets(
  assets:    AssetStatus[],
  filterKey: FilterKey,
): AssetStatus[] {
  switch (filterKey) {
    case "opportunity":
      return assets.filter(a => opportunityScore(a) >= 35);
    case "buying":
      return assets.filter(a => a.last_action === "BUY");
    case "holding":
      return assets.filter(a => a.last_action === "HOLD");
    case "selling":
      return assets.filter(a => a.last_action === "SELL");
    default:
      return assets;
  }
}
