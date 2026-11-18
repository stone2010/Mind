import { useId, useRef } from "react";
import { BarChart3, Download } from "lucide-react";

interface ChartSeries {
  name: string;
  values: number[];
}

interface ChartSpec {
  type: "bar" | "line" | "pie";
  title?: string;
  subtitle?: string;
  unit?: string;
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

export function parseChart(code: string): ChartSpec | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(code) as Record<string, unknown>;
  } catch {
    // 容错：尝试补全常见截断/笔误（末尾缺 } 等）
    const fixed = code.trim().replace(/\s+$/, "");
    try {
      parsed = JSON.parse(fixed + (fixed.endsWith("{") ? "}" : "")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const type = parsed.type;
  if (type !== "bar" && type !== "line" && type !== "pie") return null;

  // labels / series 可能在顶层，也可能被模型放进嵌套的 data 对象里
  const holder: Record<string, unknown> =
    parsed.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : parsed;

  const rawSeriesIn = holder.series ?? holder.values ?? parsed.series ?? parsed.values;
  const rawSeries: unknown = rawSeriesIn;

  // 归一化为 [{name, values}]：兼容 series 被写成对象、缺 name、值放数组等
  let normalized: { name?: unknown; values: unknown }[] | null = null;
  if (Array.isArray(rawSeries)) {
    normalized = rawSeries;
  } else if (rawSeries && typeof rawSeries === "object") {
    // 模型把单个 series 写成对象 {"name":..,"values":[..]}
    normalized = [rawSeries as { name?: unknown; values: unknown }];
  } else if (Array.isArray(holder.labels) && Array.isArray(parsed.labels)) {
    normalized = [{ name: "值", values: parsed.labels }];
  } else {
    normalized = null;
  }
  if (!normalized) return null;

  const series: ChartSeries[] = [];
  for (const item of normalized.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    let values = record.values;
    if (!Array.isArray(values)) {
      // 容错：值可能放在 data 里
      const alt = (record as { data?: unknown }).data;
      if (alt && typeof alt === "object" && Array.isArray((alt as Record<string, unknown>).values)) {
        values = (alt as Record<string, unknown>).values;
      }
    }
    if (!Array.isArray(values)) continue;
    const nums = values
      .slice(0, 30)
      .map((value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
      });
    if (nums.length === 0) continue;
    series.push({
      name: typeof record.name === "string" ? record.name : `系列 ${series.length + 1}`,
      values: nums,
    });
  }
  if (series.length === 0) return null;

  const length = Math.max(...series.map((s) => s.values.length));
  for (const item of series) {
    while (item.values.length < length) item.values.push(0);
  }
  const rawLabels = holder.labels ?? parsed.labels;
  const labels = Array.isArray(rawLabels)
    ? (rawLabels as unknown[]).slice(0, length).map((label) => String(label).slice(0, 16))
    : Array.from({ length }, (_, index) => String(index + 1));
  while (labels.length < length) labels.push(String(labels.length + 1));
  return {
    type,
    title: typeof parsed.title === "string" ? parsed.title.slice(0, 80) : undefined,
    subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle.slice(0, 100) : undefined,
    unit: typeof parsed.unit === "string" ? parsed.unit.slice(0, 12) : undefined,
    labels,
    series,
  };
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
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {series.map((item, index) => (
        <span key={`${item.name}-${index}`} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: COLORS[index % COLORS.length] }}
          />
          {item.name}
        </span>
      ))}
    </div>
  );
}

function CartesianChart({ spec }: { spec: ChartSpec }) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 720;
  const height = 340;
  const padding = { left: 54, right: 22, top: 22, bottom: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = niceMax(Math.max(...spec.series.flatMap((s) => s.values), 0));
  const count = spec.labels.length;
  const groupWidth = plotWidth / Math.max(1, count);
  const labelStep = count > 14 ? Math.ceil(count / 11) : 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const valueLabels = count * spec.series.length <= 18;

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label={spec.title ?? "数据图"}
      >
        <defs>
          {spec.series.map((_, index) => (
            <linearGradient
              key={index}
              id={`${gradientId}-area-${index}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={COLORS[index % COLORS.length]}
                stopOpacity={0.24}
              />
              <stop
                offset="100%"
                stopColor={COLORS[index % COLORS.length]}
                stopOpacity={0}
              />
            </linearGradient>
          ))}
        </defs>

        {spec.unit && (
          <text x={padding.left} y={12} fontSize={9.5} fill="var(--faint)">
            {spec.unit}
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
                strokeDasharray={tick === 0 ? undefined : "3 5"}
              />
              <text
                x={padding.left - 9}
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

        <line
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={padding.top + plotHeight}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />

        {spec.labels.map((label, index) => {
          if (index % labelStep !== 0) return null;
          const x = padding.left + groupWidth * (index + 0.5);
          return (
            <text
              key={`${label}-${index}`}
              x={x}
              y={height - 23}
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
                <g key={`${label}-${seriesIndex}`}>
                  <rect
                    x={x + 1}
                    y={padding.top + plotHeight - barHeight}
                    width={Math.max(2, barWidth - 2)}
                    height={barHeight}
                    rx={3.5}
                    fill={COLORS[seriesIndex % COLORS.length]}
                    opacity={0.9}
                  >
                    <title>
                      {label} · {item.name}: {formatNumber(item.values[index] ?? 0)}
                      {spec.unit ?? ""}
                    </title>
                  </rect>
                  {valueLabels && value > 0 && (
                    <text
                      x={x + barWidth / 2}
                      y={padding.top + plotHeight - barHeight - 5}
                      textAnchor="middle"
                      fontSize={9}
                      fill="var(--muted)"
                    >
                      {formatNumber(value)}
                    </text>
                  )}
                </g>
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
            const baseline = padding.top + plotHeight;
            const areaPath = points.length
              ? `M ${points[0].x} ${baseline} ${points
                  .map((p) => `L ${p.x} ${p.y}`)
                  .join(" ")} L ${points[points.length - 1].x} ${baseline} Z`
              : "";
            return (
              <g key={`${item.name}-${seriesIndex}`}>
                {areaPath && (
                  <path
                    d={areaPath}
                    fill={`url(#${gradientId}-area-${seriesIndex})`}
                  />
                )}
                <polyline
                  points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={COLORS[seriesIndex % COLORS.length]}
                  strokeWidth={2.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {points.map((point) => (
                  <circle
                    key={point.index}
                    cx={point.x}
                    cy={point.y}
                    r={3.4}
                    fill="var(--panel)"
                    stroke={COLORS[seriesIndex % COLORS.length]}
                    strokeWidth={2}
                  >
                    <title>
                      {spec.labels[point.index]} · {item.name}: {formatNumber(point.value)}
                      {spec.unit ?? ""}
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
  const cy = 160;
  const outer = 112;
  const inner = 68;
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
    const mid = (start + end) / 2;
    const outerStart = [cx + outer * Math.cos(start), cy + outer * Math.sin(start)];
    const outerEnd = [cx + outer * Math.cos(end), cy + outer * Math.sin(end)];
    const innerEnd = [cx + inner * Math.cos(end), cy + inner * Math.sin(end)];
    const innerStart = [cx + inner * Math.cos(start), cy + inner * Math.sin(start)];
    const path =
      fraction >= 0.999
        ? `M ${cx} ${cy - outer} A ${outer} ${outer} 0 1 1 ${cx - 0.01} ${cy - outer} Z M ${cx} ${cy - inner} A ${inner} ${inner} 0 1 0 ${cx - 0.01} ${cy - inner} Z`
        : `M ${outerStart[0]} ${outerStart[1]} A ${outer} ${outer} 0 ${large} 1 ${outerEnd[0]} ${outerEnd[1]} L ${innerEnd[0]} ${innerEnd[1]} A ${inner} ${inner} 0 ${large} 0 ${innerStart[0]} ${innerStart[1]} Z`;
    return { value, fraction, path, index, mid };
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-[440px]"
        role="img"
        aria-label={spec.title ?? "饼图"}
      >
        {slices.map((slice) => (
          <path
            key={slice.index}
            d={slice.path}
            fill={COLORS[slice.index % COLORS.length]}
            stroke="var(--panel)"
            strokeWidth={2}
            opacity={0.92}
          >
            <title>
              {spec.labels[slice.index]}: {formatNumber(slice.value)}
              {spec.unit ?? ""}（{(slice.fraction * 100).toFixed(1)}%）
            </title>
          </path>
        ))}
        {slices.map((slice) =>
          slice.fraction >= 0.05 ? (
            <text
              key={`label-${slice.index}`}
              x={cx + 90 * Math.cos(slice.mid)}
              y={cy + 90 * Math.sin(slice.mid)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={600}
              fill="#fff"
            >
              {(slice.fraction * 100).toFixed(0)}%
            </text>
          ) : null,
        )}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize={20}
          fontWeight={650}
          fill="var(--ink)"
        >
          {formatNumber(total)}
          {spec.unit === "%" ? "%" : ""}
        </text>
        <text
          x={cx}
          y={cy + 15}
          textAnchor="middle"
          fontSize={10}
          fill="var(--faint)"
        >
          总计
        </text>
      </svg>
      <div className="w-full max-w-[260px] space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-2 text-[11.5px]">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: COLORS[index % COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-muted">
              {spec.labels[index]}
            </span>
            <span className="tabular-nums text-faint">
              {spec.unit === "%"
                ? `${((value / total) * 100).toFixed(0)}%`
                : `${formatNumber(value)}${spec.unit ?? ""} · ${((value / total) * 100).toFixed(0)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartBlock({ code }: { code: string }) {
  const spec = parseChart(code);
  const containerRef = useRef<HTMLDivElement>(null);

  const downloadSvg = () => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(spec?.title ?? "chart").replace(/[^\w一-鿿-]+/g, "-")}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!spec) {
    return (
      <div className="my-3 rounded-xl border border-line bg-panel p-3">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <BarChart3 size={13} className="text-faint" />
          <span>图表数据无法渲染</span>
        </div>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sidebar p-2 font-mono text-[10.5px] leading-4 text-muted">
          {code}
        </pre>
        <p className="mt-1.5 text-[11px] text-faint">
          模型返回的图表 JSON 格式不正确。可以点「重新生成」让模型重画，或让它改用列表 / 表格呈现。
        </p>
      </div>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start gap-2.5 border-b border-line/80 bg-sidebar/60 px-3.5 py-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <BarChart3 size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">
            {spec.title ?? "数据图"}
          </div>
          <div className="mt-0.5 text-[10.5px] text-faint">
            {spec.subtitle ?? "由模型生成的结构化数据"}
          </div>
        </div>
        <button
          onClick={downloadSvg}
          aria-label="下载图表 SVG"
          title="下载 SVG"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <Download size={13.5} />
        </button>
      </div>
      <div ref={containerRef} className="px-2 pb-3 pt-4 sm:px-4">
        {spec.type === "pie" ? (
          <PolarChart spec={spec} />
        ) : (
          <CartesianChart spec={spec} />
        )}
      </div>
    </div>
  );
}
