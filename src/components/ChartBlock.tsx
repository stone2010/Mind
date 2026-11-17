import { BarChart3 } from "lucide-react";

interface ChartSeries {
  name: string;
  values: number[];
}

interface ChartSpec {
  type: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  series: ChartSeries[];
}

const COLORS = [
  "var(--accent)",
  "var(--success)",
  "#e0a53a",
  "#9b7bf5",
  "var(--danger)",
  "#2aa7a0",
];

function parseChart(code: string): ChartSpec | null {
  try {
    const parsed = JSON.parse(code) as Record<string, unknown>;
    const type = parsed.type;
    if (type !== "bar" && type !== "line" && type !== "pie") return null;
    const rawSeries = Array.isArray(parsed.series)
      ? parsed.series
      : Array.isArray(parsed.values)
        ? [{ name: "值", values: parsed.values }]
        : null;
    if (!rawSeries) return null;
    const series: ChartSeries[] = [];
    for (const item of rawSeries.slice(0, 6)) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (!Array.isArray(record.values)) continue;
      const values = record.values
        .slice(0, 30)
        .map((value) => {
          const number = Number(value);
          return Number.isFinite(number) ? number : 0;
        });
      if (values.length === 0) continue;
      series.push({
        name: typeof record.name === "string" ? record.name : `系列 ${series.length + 1}`,
        values,
      });
    }
    if (series.length === 0) return null;
    const length = Math.max(...series.map((s) => s.values.length));
    for (const item of series) {
      while (item.values.length < length) item.values.push(0);
    }
    const labels = Array.isArray(parsed.labels)
      ? parsed.labels.slice(0, length).map((label) => String(label).slice(0, 16))
      : Array.from({ length }, (_, index) => String(index + 1));
    while (labels.length < length) labels.push(String(labels.length + 1));
    return {
      type,
      title: typeof parsed.title === "string" ? parsed.title.slice(0, 80) : undefined,
      labels,
      series,
    };
  } catch {
    return null;
  }
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * power;
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {series.map((item, index) => (
        <span key={`${item.name}-${index}`} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: COLORS[index % COLORS.length] }}
          />
          {item.name}
        </span>
      ))}
    </div>
  );
}

function CartesianChart({ spec }: { spec: ChartSpec }) {
  const width = 680;
  const height = 320;
  const padding = { left: 48, right: 18, top: spec.title ? 46 : 20, bottom: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = niceMax(
    Math.max(...spec.series.flatMap((s) => s.values), 0),
  );
  const count = spec.labels.length;
  const groupWidth = plotWidth / Math.max(1, count);
  const labelStep = count > 12 ? Math.ceil(count / 10) : 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img">
        {spec.title && (
          <text
            x={padding.left}
            y={26}
            fontSize={14}
            fontWeight={600}
            fill="var(--ink)"
          >
            {spec.title}
          </text>
        )}
        {ticks.map((tick) => {
          const y = padding.top + plotHeight * (1 - tick);
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="var(--line)"
                strokeWidth={1}
                strokeDasharray={tick === 0 ? undefined : "3 4"}
              />
              <text
                x={padding.left - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={9.5}
                fill="var(--faint)"
              >
                {formatNumber(maxValue * tick)}
              </text>
            </g>
          );
        })}
        {spec.labels.map((label, index) => {
          if (index % labelStep !== 0) return null;
          const x = padding.left + groupWidth * (index + 0.5);
          return (
            <text
              key={`${label}-${index}`}
              x={x}
              y={height - 24}
              textAnchor="middle"
              fontSize={9.5}
              fill="var(--faint)"
            >
              {label}
            </text>
          );
        })}

        {spec.type === "bar" &&
          spec.labels.map((label, index) => {
            const totalWidth = groupWidth * 0.68;
            const barWidth = totalWidth / spec.series.length;
            return spec.series.map((item, seriesIndex) => {
              const value = Math.max(0, item.values[index] ?? 0);
              const barHeight = (value / maxValue) * plotHeight;
              const x =
                padding.left +
                groupWidth * index +
                (groupWidth - totalWidth) / 2 +
                barWidth * seriesIndex;
              return (
                <rect
                  key={`${label}-${seriesIndex}`}
                  x={x + 1}
                  y={padding.top + plotHeight - barHeight}
                  width={Math.max(2, barWidth - 2)}
                  height={barHeight}
                  rx={2}
                  fill={COLORS[seriesIndex % COLORS.length]}
                  opacity={0.9}
                >
                  <title>
                    {label} · {item.name}: {formatNumber(item.values[index] ?? 0)}
                  </title>
                </rect>
              );
            });
          })}

        {spec.type === "line" &&
          spec.series.map((item, seriesIndex) => {
            const points = item.values
              .map((value, index) => {
                const x = padding.left + groupWidth * (index + 0.5);
                const y =
                  padding.top + plotHeight - (Math.max(0, value) / maxValue) * plotHeight;
                return { x, y, value, index };
              });
            return (
              <g key={`${item.name}-${seriesIndex}`}>
                <polyline
                  points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={COLORS[seriesIndex % COLORS.length]}
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {points.map((point) => (
                  <circle
                    key={point.index}
                    cx={point.x}
                    cy={point.y}
                    r={3.2}
                    fill="var(--panel)"
                    stroke={COLORS[seriesIndex % COLORS.length]}
                    strokeWidth={2}
                  >
                    <title>
                      {spec.labels[point.index]} · {item.name}: {formatNumber(point.value)}
                    </title>
                  </circle>
                ))}
              </g>
            );
          })}
      </svg>
      <Legend series={spec.series} />
    </>
  );
}

function PolarChart({ spec }: { spec: ChartSpec }) {
  const values = spec.series[0]?.values ?? [];
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const width = 680;
  const height = 320;
  const cx = 210;
  const cy = 166;
  const radius = 112;
  let angle = -Math.PI / 2;

  if (total <= 0) {
    return (
      <div className="flex h-40 items-center justify-center text-[12px] text-faint">
        图表数据全为 0。
      </div>
    );
  }

  const slices = values.map((raw, index) => {
    const value = Math.max(0, raw);
    const fraction = value / total;
    const start = angle;
    const end = angle + fraction * Math.PI * 2;
    angle = end;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + radius * Math.cos(start);
    const y1 = cy + radius * Math.sin(start);
    const x2 = cx + radius * Math.cos(end);
    const y2 = cy + radius * Math.sin(end);
    const path =
      fraction >= 0.999
        ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
    return { value, fraction, path, index };
  });

  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[420px]" role="img">
        {spec.title && (
          <text x={20} y={26} fontSize={14} fontWeight={600} fill="var(--ink)">
            {spec.title}
          </text>
        )}
        {slices.map((slice) => (
          <path
            key={slice.index}
            d={slice.path}
            fill={COLORS[slice.index % COLORS.length]}
            stroke="var(--panel)"
            strokeWidth={2}
            opacity={0.9}
          >
            <title>
              {spec.labels[slice.index]}: {formatNumber(slice.value)}（
              {(slice.fraction * 100).toFixed(1)}%）
            </title>
          </path>
        ))}
      </svg>
      <div className="w-full max-w-[260px] space-y-1.5">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-2 text-[11.5px]">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: COLORS[index % COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-muted">
              {spec.labels[index]}
            </span>
            <span className="tabular-nums text-faint">
              {formatNumber(value)} · {((value / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartBlock({ code }: { code: string }) {
  const spec = parseChart(code);
  if (!spec) {
    return (
      <div className="my-3 rounded-xl border border-danger/25 bg-danger-soft p-3">
        <p className="text-[12px] text-danger">无法解析 chart 代码块，需要 JSON 数据。</p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-panel/70 p-2 font-mono text-[10.5px] leading-4 text-muted">
          {code}
        </pre>
      </div>
    );
  }
  return (
    <div className="my-3 rounded-xl border border-line bg-panel p-3">
      <div className="mb-1 flex items-center gap-2 text-[11.5px] text-muted">
        <BarChart3 size={13} className="text-accent" />
        数据图
        <span className="text-faint">由模型生成的结构化数据</span>
      </div>
      {spec.type === "pie" ? (
        <PolarChart spec={spec} />
      ) : (
        <CartesianChart spec={spec} />
      )}
    </div>
  );
}
