import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { t } from "@/i18n";
import { bucketLabel, bucketTitle, formatAmount } from "./logic";
import type { Granularity, SeriesPoint } from "./types";

interface SalesChartProps {
  series: SeriesPoint[];
  granularity: Granularity;
  currency: string;
}

/** Ventas netas en el tiempo. Se carga aparte (recharts pesa): el resumen aparece sin esperarlo. */
export default function SalesChart({ series, granularity, currency }: SalesChartProps) {
  const data = series.map((p) => ({
    bucket: p.bucket,
    net: p.net,
    orders: p.orders,
    margin: p.margin,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={(v: string) => bucketLabel(v, granularity)}
          tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
          minTickGap={24}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
        />
        <YAxis
          width={56}
          tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(value: number, name: string) =>
            name === "orders"
              ? [String(value), t("admin.analytics.dashboard.series.orders")]
              : [formatAmount(value, currency), t("admin.analytics.dashboard.series.net")]
          }
          labelFormatter={(label: string) => bucketTitle(label, granularity)}
          contentStyle={{
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            background: "hsl(var(--background))",
            color: "hsl(var(--foreground))",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="net"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#salesFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
