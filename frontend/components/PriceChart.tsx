"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
  LineChart,
} from "recharts";
import { fetchOhlcv, type OhlcvCandle } from "@/lib/api";
import styles from "./PriceChart.module.css";

type Timeframe = "1h" | "4h" | "1d" | "1w";

const TF_LABELS: Record<Timeframe, string> = {
  "1h": "1D", "4h": "1W", "1d": "1M", "1w": "1Y",
};

function ema(data: OhlcvCandle[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = [];
  let emaVal: number | null = null;
  for (const c of data) {
    if (emaVal === null) {
      emaVal = c.close;
    } else {
      emaVal = c.close * k + emaVal * (1 - k);
    }
    result.push(parseFloat(emaVal.toFixed(4)));
  }
  return result;
}

function rsiSeries(data: OhlcvCandle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(period).fill(null);
  if (data.length <= period) return result;
  const closes = data.map(c => c.close);
  const deltas = closes.slice(1).map((v, i) => v - closes[i]);
  let avgGain = deltas.slice(0, period).reduce((s, d) => s + Math.max(d, 0), 0) / period;
  let avgLoss = deltas.slice(0, period).reduce((s, d) => s + Math.abs(Math.min(d, 0)), 0) / period;
  result.push(avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2)));
  for (let i = period; i < deltas.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(deltas[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.abs(Math.min(deltas[i], 0))) / period;
    result.push(avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2)));
  }
  return result;
}

function fmtTime(ts: number, tf: Timeframe) {
  const d = new Date(ts);
  if (tf === "1h")  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (tf === "4h")  return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fmtPrice(v: number) {
  return v >= 1000
    ? v.toLocaleString("en-EU", { maximumFractionDigits: 0 })
    : v.toLocaleString("en-EU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

const CustomTooltip = ({ active, payload, label, tf }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[];
  label?: number; tf: Timeframe;
}) => {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTime}>{fmtTime(label, tf)}</div>
      {payload.map(p => (
        <div key={p.name} className={styles.tooltipRow}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span>{typeof p.value === "number" ? fmtPrice(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function PriceChart({ symbol }: { symbol: string }) {
  const [tf,      setTf]      = useState<Timeframe>("1h");
  const [candles, setCandles] = useState<OhlcvCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOhlcv(symbol, tf);
      setCandles(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chart");
    } finally {
      setLoading(false);
    }
  }, [symbol, tf]);

  useEffect(() => { load(); }, [load]);

  const ema9  = ema(candles, 9);
  const ema21 = ema(candles, 21);
  const rsi   = rsiSeries(candles);

  const priceData = candles.map((c, i) => ({
    timestamp: c.timestamp,
    close:     c.close,
    ema9:      ema9[i],
    ema21:     ema21[i],
  }));

  const rsiData = candles.map((c, i) => ({
    timestamp: c.timestamp,
    rsi:       rsi[i],
  }));

  const prices = candles.map(c => c.close);
  const minP = Math.min(...prices) * 0.998;
  const maxP = Math.max(...prices) * 1.002;

  return (
    <div className={styles.wrapper}>
      {/* Timeframe selector */}
      <div className={styles.tfRow}>
        {(Object.keys(TF_LABELS) as Timeframe[]).map(t => (
          <button
            key={t}
            className={`${styles.tfBtn} ${tf === t ? styles.tfActive : ""}`}
            onClick={() => setTf(t)}
          >
            {TF_LABELS[t]}
          </button>
        ))}
        <button className={styles.reloadBtn} onClick={load} title="Reload">↻</button>
      </div>

      {loading && <div className={styles.loader}><div className={styles.spinner} /></div>}
      {error   && <div className={styles.errMsg}>{error}</div>}

      {!loading && !error && candles.length > 0 && (
        <>
          {/* Price + EMA chart */}
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={priceData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={v => fmtTime(v, tf)}
                tick={{ fill: "#8892a4", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={[minP, maxP]}
                tickFormatter={fmtPrice}
                tick={{ fill: "#8892a4", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={60}
              />
              <Tooltip content={<CustomTooltip tf={tf} />} />
              <Legend
                iconType="line"
                iconSize={10}
                wrapperStyle={{ fontSize: "0.72rem", paddingTop: "4px" }}
              />
              <Area
                type="monotone"
                dataKey="close"
                name="Price"
                stroke="#3b82f6"
                strokeWidth={1.5}
                fill={`url(#grad-${symbol})`}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Line type="monotone" dataKey="ema9"  name="EMA 9"  stroke="#f59e0b" strokeWidth={1} dot={false} />
              <Line type="monotone" dataKey="ema21" name="EMA 21" stroke="#a855f7" strokeWidth={1} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>

          {/* RSI chart */}
          <div className={styles.rsiLabel}>RSI (14)</div>
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={rsiData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="timestamp" hide />
              <YAxis
                domain={[0, 100]}
                ticks={[30, 50, 70]}
                tick={{ fill: "#8892a4", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={30}
              />
              <Tooltip
                formatter={(v: number) => [v?.toFixed(1), "RSI"]}
                labelFormatter={v => fmtTime(Number(v), tf)}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "0.78rem" }}
              />
              <ReferenceLine y={70} stroke="rgba(239,68,68,0.4)"   strokeDasharray="4 2" label={{ value: "70", fill: "#ef4444", fontSize: 9, position: "insideTopRight" }} />
              <ReferenceLine y={50} stroke="rgba(255,255,255,0.1)" strokeDasharray="2 4" />
              <ReferenceLine y={30} stroke="rgba(34,197,94,0.4)"   strokeDasharray="4 2" label={{ value: "30", fill: "#22c55e", fontSize: 9, position: "insideBottomRight" }} />
              <Line
                type="monotone"
                dataKey="rsi"
                stroke="#e2e8f0"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
