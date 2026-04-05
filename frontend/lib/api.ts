export interface AssetStatus {
  symbol:       string;
  last_price:   number | null;
  highest:      number | null;
  last_action:  "HOLD" | "SELL" | "BUY";
  rsi:          number | null;
  ema_fast:     number | null;
  ema_slow:     number | null;
  drop_pct:     number | null;
  dry_run:      boolean;
  last_updated: string | null;
  error:        string | null;
}

export interface StatusResponse {
  assets: AssetStatus[];
}

export interface BotStatus {
  running:  boolean;
  dry_run:  boolean;
}

export interface PortfolioBalance {
  free:  number;
  used:  number;
  total: number;
}

export interface Portfolio {
  balances: Record<string, PortfolioBalance>;
}

export interface TradeResult {
  ok:           boolean;
  dry_run?:     boolean;
  order_id?:    string;
  symbol?:      string;
  amount_eur?:  number;
  error?:       string;
}

export interface LiquidateResult {
  results: (TradeResult & { symbol: string })[];
}

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? `Request failed (${res.status})`);
  return data as T;
}

export const fetchStatus    = () => apiFetch<StatusResponse>("/status");
export const fetchBotStatus = () => apiFetch<BotStatus>("/bot/status");
export const fetchPortfolio = () => apiFetch<Portfolio>("/portfolio");
export const startBot       = () => apiFetch<BotStatus>("/bot/start",     { method: "POST" });
export const stopBot        = () => apiFetch<BotStatus>("/bot/stop",      { method: "POST" });
export const liquidateAll   = () => apiFetch<LiquidateResult>("/bot/liquidate", { method: "POST" });

export function executeTrade(
  symbol: string,
  side: "buy" | "sell",
  amount_eur?: number,
): Promise<TradeResult> {
  return apiFetch<TradeResult>("/trade", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ symbol, side, amount_eur }),
  });
}

export function withdrawEur(amount: number, key: string): Promise<{ ok: boolean }> {
  return apiFetch("/withdraw", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ currency: "EUR", amount, key }),
  });
}
