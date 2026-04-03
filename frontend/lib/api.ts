export interface AssetStatus {
  symbol: string;
  last_price: number | null;
  highest: number | null;
  last_action: "HOLD" | "SELL" | "BUY";
  rsi: number | null;
  last_updated: string | null;
  error: string | null;
}

export interface StatusResponse {
  assets: AssetStatus[];
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:8000";

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_URL}/status`, {
    // Disable Next.js cache so every call hits the live backend
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  return res.json();
}
