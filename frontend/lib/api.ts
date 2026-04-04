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

export interface TradeResult {
  ok:            boolean;
  dry_run?:      boolean;
  order_id?:     string;
  symbol?:       string;
  amount_eur?:   number;
  error?:        string;
}

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_URL}/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function executeTrade(
  symbol: string,
  side: "buy" | "sell",
  amount_eur?: number,
): Promise<TradeResult> {
  const res = await fetch(`${API_URL}/trade`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, side, amount_eur }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? `Trade failed (${res.status})`);
  return data;
}
