// ── Types ─────────────────────────────────────────────────────────────────────

export interface AssetStatus {
  symbol:              string;
  last_price:          number | null;
  highest:             number | null;
  entry_price:         number | null;
  last_action:         "HOLD" | "SELL" | "BUY";
  rsi:                 number | null;
  ema_fast:            number | null;
  ema_slow:            number | null;
  drop_pct:            number | null;
  unrealised_pnl_pct:  number | null;
  dry_run:               boolean;
  hold_until_overbought: boolean;
  rsi_overbought_target: number;
  disabled:              boolean;
  last_updated:          string | null;
  error:                 string | null;
}

export interface BotStatus {
  running:      boolean;
  dry_run:      boolean;
  daily_pnl:    number;
  paused_loss:  boolean;
}

export interface PortfolioBalance {
  free:                number;
  used:                number;
  total:               number;
  eur_price:           number | null;
  eur_value:           number | null;
  unrealised_pnl_eur:  number | null;
}

export interface Portfolio {
  balances:      Record<string, PortfolioBalance>;
  total_eur:     number;
  daily_pnl:     number;
  all_time_pnl:  number;
  paused_loss:   boolean;
}

export interface Trade {
  timestamp:     string;
  symbol:        string;
  side:          "buy" | "sell";
  price:         number;
  amount_eur?:   number;
  amount_crypto?: number;
  pnl_eur?:      number;
  dry_run:       boolean;
  reason?:       string;
  order_id?:     string;
}

export interface TradeHistoryResponse { trades: Trade[]; total: number; }

export interface OhlcvCandle {
  timestamp: number;
  time:      string;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
}

export interface OhlcvResponse { symbol: string; timeframe: string; data: OhlcvCandle[]; }

export interface TradeResult {
  ok:           boolean;
  dry_run?:     boolean;
  order_id?:    string;
  symbol?:      string;
  amount_eur?:  number;
  error?:       string;
}

export interface LiquidateResult { results: (TradeResult & { symbol: string })[]; }

export interface BotConfig {
  symbols:            string[];
  trade_amount_eur:   number;
  trailing_stop_pct:  number;
  take_profit_pct:    number;
  rsi_period:         number;
  rsi_oversold:       number;
  rsi_overbought:     number;
  rsi_timeframe:      "1h" | "4h" | "1d";
  ema_fast:           number;
  ema_slow:           number;
  max_daily_loss_eur: number;
  webhook_url:        string;
  kraken_api_key:     string;
  kraken_api_secret:  string;
  dry_run:            boolean;
}

export type ProfileName = "conservative" | "moderate" | "aggressive" | "custom";
export type Profiles = Record<ProfileName, Omit<BotConfig, "dry_run" | "kraken_api_key" | "kraken_api_secret">>;

// ── Client ────────────────────────────────────────────────────────────────────

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res  = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? `Request failed (${res.status})`);
  return data as T;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const fetchStatus    = () => apiFetch<{ assets: AssetStatus[] }>("/status");
export const fetchBotStatus = () => apiFetch<BotStatus>("/bot/status");
export const fetchPortfolio = () => apiFetch<Portfolio>("/portfolio");
export const fetchTrades    = (limit = 50) => apiFetch<TradeHistoryResponse>(`/trades?limit=${limit}`);
export const fetchOhlcv     = (symbol: string, timeframe: string) =>
  apiFetch<OhlcvResponse>(`/ohlcv?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`);

export const startBot     = () => apiFetch<BotStatus>("/bot/start",     { method: "POST" });
export const stopBot      = () => apiFetch<BotStatus>("/bot/stop",      { method: "POST" });
export const liquidateAll = () => apiFetch<LiquidateResult>("/bot/liquidate", { method: "POST" });

export function executeTrade(symbol: string, side: "buy" | "sell", amount_eur?: number): Promise<TradeResult> {
  return apiFetch<TradeResult>("/trade", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ symbol, side, amount_eur }),
  });
}

export function setHoldUntilOverbought(symbol: string, enabled: boolean): Promise<{ symbol: string; hold_until_overbought: boolean; rsi_target: number }> {
  return apiFetch(`/bot/hold/${encodeURIComponent(symbol)}?enabled=${enabled}`, { method: "POST" });
}

export function setSymbolDisabled(symbol: string, disabled: boolean): Promise<{ symbol: string; disabled: boolean }> {
  return apiFetch(`/bot/symbol/${encodeURIComponent(symbol)}?disabled=${disabled}`, { method: "POST" });
}

export function withdrawEur(amount: number, key: string): Promise<{ ok: boolean }> {
  return apiFetch("/withdraw", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ currency: "EUR", amount, key }),
  });
}

export const fetchConfig   = () => apiFetch<BotConfig>("/config");
export const fetchProfiles = () => apiFetch<Profiles>("/config/profiles");

export function updateConfig(data: Partial<BotConfig>): Promise<BotConfig> {
  return apiFetch<BotConfig>("/config", {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  });
}

export function resetConfig(profile: ProfileName): Promise<BotConfig> {
  return apiFetch<BotConfig>(`/config/reset/${profile}`, { method: "POST" });
}
