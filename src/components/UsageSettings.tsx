import { BarChart3, Eraser, RefreshCw, Scale, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/bridge";
import {
  DEEPSEEK_PEAK_LABEL,
  deepseekCnyRows,
  formatFen,
  isPeakTime,
  modelPriceKey,
  summarizeUsage,
} from "../lib/pricing";
import { useAppStore } from "../store/app";
import { confirmDialog } from "../store/confirm";
import { pushToast } from "../store/toast";
import type { ModelPrice, UsageLogEntry } from "../types";
import { Button, Field, Input, Switch } from "./ui";

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatMoney(value: number): string {
  if (value === 0) return "¥0";
  if (value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "peak" | "offpeak";
}) {
  return (
    <div
      className={
        tone === "peak"
          ? "rounded-xl border border-accent/20 bg-accent-soft/50 p-3.5"
          : tone === "offpeak"
            ? "rounded-xl border border-line bg-sidebar p-3.5"
            : "rounded-xl border border-line p-3.5"
      }
    >
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tracking-[-0.01em] text-ink">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

type PriceDraft = {
  peakInput: string;
  peakOutput: string;
  offpeakInput: string;
  offpeakOutput: string;
};

const EMPTY_DRAFT: PriceDraft = {
  peakInput: "0",
  peakOutput: "0",
  offpeakInput: "0",
  offpeakOutput: "0",
};

export function UsageSettings() {
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const enabled = settings.usageEnabled;

  const [logs, setLogs] = useState<UsageLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [rateDraft, setRateDraft] = useState(String(settings.usdCnyRate));
  const [modelDrafts, setModelDrafts] = useState<Record<string, PriceDraft>>({});

  const externalModels = useMemo(
    () =>
      providers
        .filter((p) => p.kind !== "deepseek" && p.id !== "deepseek")
        .flatMap((provider) =>
          provider.models.map((model) => ({
            key: modelPriceKey(provider.id, model.id),
            providerName: provider.name,
            modelName: model.label || model.id,
          })),
        ),
    [providers],
  );

  useEffect(() => {
    setRateDraft(String(settings.usdCnyRate));
  }, [settings.usdCnyRate]);

  useEffect(() => {
    const next: Record<string, PriceDraft> = {};
    for (const item of externalModels) {
      const price = settings.modelPrices?.[item.key];
      next[item.key] = price
        ? {
            peakInput: String(price.peakInput),
            peakOutput: String(price.peakOutput),
            offpeakInput: String(price.offpeakInput),
            offpeakOutput: String(price.offpeakOutput),
          }
        : { ...EMPTY_DRAFT };
    }
    setModelDrafts(next);
  }, [externalModels, settings.modelPrices]);

  const load = async () => {
    if (!enabled) {
      setLogs([]);
      return;
    }
    setLoading(true);
    try {
      setLogs(await api.listUsage(5000));
    } catch (err) {
      pushToast({ kind: "error", title: "无法读取用量记录", detail: errorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const summary = useMemo(() => summarizeUsage(logs, settings), [logs, settings]);

  const days = useMemo(() => {
    const list = Array.from({ length: 14 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (13 - index));
      return {
        key: dayKey(date.getTime()),
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        peak: 0,
        offpeak: 0,
      };
    });
    const byDay = new Map(list.map((day) => [day.key, day]));
    for (const log of logs) {
      const day = byDay.get(dayKey(log.createdAt));
      if (!day) continue;
      const tokens = log.totalTokens || log.promptTokens + log.completionTokens;
      if (isPeakTime(log.createdAt)) day.peak += tokens;
      else day.offpeak += tokens;
    }
    return list;
  }, [logs]);

  const maxDay = Math.max(1, ...days.map((day) => day.peak + day.offpeak));
  const deepseekRows = deepseekCnyRows(settings);

  const saveRate = async () => {
    const parsed = Number(rateDraft);
    const value = Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : 6.6793;
    setRateDraft(String(value));
    await updateSettings({ usdCnyRate: value });
    pushToast({ kind: "success", title: "汇率已保存，费用估算已更新" });
  };

  const updatePriceDraft = (key: string, patch: Partial<PriceDraft>) => {
    setModelDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? EMPTY_DRAFT), ...patch },
    }));
  };

  const saveModelPrices = async () => {
    const parse = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(10000, parsed)) : 0;
    };
    const next: Record<string, ModelPrice> = {};
    for (const [key, draft] of Object.entries(modelDrafts)) {
      next[key] = {
        peakInput: parse(draft.peakInput),
        peakOutput: parse(draft.peakOutput),
        offpeakInput: parse(draft.offpeakInput),
        offpeakOutput: parse(draft.offpeakOutput),
      };
    }
    await updateSettings({ modelPrices: next });
    pushToast({ kind: "success", title: "非 DeepSeek 模型价格已保存" });
  };

  const clearLogs = async () => {
    const ok = await confirmDialog({
      title: "清除全部用量记录？",
      body: "只会删除本机的 token 用量统计，不影响聊天记录和账单。",
      confirmLabel: "清除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.clearUsage();
      setLogs([]);
      pushToast({ kind: "success", title: "用量记录已清除" });
    } catch (err) {
      pushToast({ kind: "error", title: "清除失败", detail: errorMessage(err) });
    }
  };

  return (
    <section>
      <div>
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
          用量与费用
        </h2>
        <p className="mt-1 text-[12.5px] leading-5 text-muted">
          DeepSeek 默认按官方峰谷价、缓存命中价和美元汇率自动估算；其他模型可按你填写的单价估算。token 用量来自服务商返回的真实 usage。
        </p>
      </div>

      <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-line p-4">
        <div>
          <div className="text-[13px] font-medium text-ink">记录并展示用量</div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">
            关闭后不再写入新的用量记录，也不显示看板和对话内费用；已有记录保留。
          </p>
        </div>
        <Switch
          checked={enabled}
          label="记录并展示用量"
          onChange={(value) => updateSettings({ usageEnabled: value })}
        />
      </div>

      {!enabled ? (
        <div className="mt-3 rounded-xl border border-dashed border-line px-5 py-8 text-center">
          <BarChart3 size={20} className="mx-auto text-faint" />
          <p className="mt-2 text-[12.5px] text-muted">用量看板已关闭。</p>
          <p className="mt-1 text-[11.5px] text-faint">
            打开上方开关后，之后产生的 token 用量会显示在这里。
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <StatCard
              label="真实 token 用量"
              value={formatTokens(summary.totalTokens)}
              sub={`输入 ${formatTokens(summary.promptTokens)} · 输出 ${formatTokens(summary.completionTokens)}`}
            />
            <StatCard
              label="估算费用"
              value={
                summary.hasUnknownModel
                  ? "部分未配置"
                  : `≈${formatFen(summary.totalCost)}`
              }
              sub={
                summary.hasUnknownModel
                  ? "有非 DeepSeek 模型未填写价格"
                  : `${formatMoney(summary.totalCost)} · 点击对话标题栏查看单次对话`
              }
            />
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <StatCard
              label="峰时用量"
              value={formatTokens(summary.peakTokens)}
              sub={`≈${formatFen(summary.peakCost)} · ${DEEPSEEK_PEAK_LABEL}`}
              tone="peak"
            />
            <StatCard
              label="谷时用量"
              value={formatTokens(summary.offpeakTokens)}
              sub={`≈${formatFen(summary.offpeakCost)} · 其余时段`}
              tone="offpeak"
            />
          </div>

          <div className="mt-3 rounded-xl border border-line p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-ink">最近 14 天</div>
                <p className="mt-0.5 text-[11.5px] text-faint">
                  按北京时间与 DeepSeek 官方峰时窗口统计；深色为峰时，浅色为谷时。
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={13} />}
                loading={loading}
                onClick={() => void load()}
              >
                刷新
              </Button>
            </div>
            <div className="mt-4 flex h-36 items-end gap-1.5">
              {days.map((day) => {
                const peakHeight = (day.peak / maxDay) * 100;
                const offpeakHeight = (day.offpeak / maxDay) * 100;
                const total = day.peak + day.offpeak;
                return (
                  <div
                    key={day.key}
                    className="flex h-full min-w-0 flex-1 flex-col justify-end"
                    title={`${day.label}：${formatTokens(total)} tokens（峰 ${formatTokens(day.peak)} / 谷 ${formatTokens(day.offpeak)}）`}
                  >
                    <div
                      className="w-full rounded-t-[3px] bg-accent"
                      style={{ height: `${peakHeight}%`, minHeight: day.peak > 0 ? 2 : 0 }}
                    />
                    <div
                      className="w-full bg-accent/30"
                      style={{
                        height: `${offpeakHeight}%`,
                        minHeight: day.offpeak > 0 ? 2 : 0,
                      }}
                    />
                    <div className="mt-1 truncate text-center text-[9px] text-faint">
                      {day.label}
                    </div>
                  </div>
                );
              })}
            </div>
            {summary.totalTokens === 0 && (
              <p className="mt-3 text-center text-[11.5px] text-faint">
                还没有用量记录。发送一条真实模型消息后，这里会显示 token 和费用。
              </p>
            )}
          </div>

          <div className="mt-3 rounded-xl border border-line p-4">
            <div className="flex items-center gap-2">
              <Wallet size={14} className="text-accent" />
              <div className="text-[13px] font-medium text-ink">DeepSeek 官方价格</div>
              <span className="rounded border border-accent/25 px-1 py-px text-[9.5px] text-accent">
                自动
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
              按官方 USD/百万 tokens 价格 × 汇率估算；峰时价格为谷时的 2 倍，缓存命中单独计价。
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-[11.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-faint">
                    <th className="pb-1.5 font-normal">模型</th>
                    <th className="pb-1.5 font-normal">谷时输入</th>
                    <th className="pb-1.5 font-normal">峰时输入</th>
                    <th className="pb-1.5 font-normal">谷时输出</th>
                    <th className="pb-1.5 font-normal">峰时输出</th>
                  </tr>
                </thead>
                <tbody>
                  {deepseekRows.map((row) => (
                    <tr key={row.label} className="border-b border-line/60 last:border-0">
                      <td className="py-1.5 text-ink">{row.label}</td>
                      <td className="py-1.5 tabular-nums text-muted">¥{row.offpeakInput.toFixed(2)}</td>
                      <td className="py-1.5 tabular-nums text-muted">¥{row.peakInput.toFixed(2)}</td>
                      <td className="py-1.5 tabular-nums text-muted">¥{row.offpeakOutput.toFixed(2)}</td>
                      <td className="py-1.5 tabular-nums text-muted">¥{row.peakOutput.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <Field label="USD → CNY 汇率" hint="仅用于费用估算">
                <Input
                  type="number"
                  min={1}
                  max={20}
                  step={0.0001}
                  value={rateDraft}
                  onChange={(e) => setRateDraft(e.target.value)}
                  className="h-8 w-[130px] tabular-nums text-[12.5px]"
                />
              </Field>
              <Button size="sm" variant="secondary" onClick={() => void saveRate()}>
                保存汇率
              </Button>
              <span className="flex items-center gap-1 text-[10.5px] text-faint">
                <Scale size={11} />
                {DEEPSEEK_PEAK_LABEL}；法定节假日暂按工作日计算
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-faint">
              官方价格可能调整。当前参考 2026-11-17 页面：Flash 输入（缓存未命中）$0.15–0.30 / 输出 $0.60–1.20；Pro 输入 $0.66–1.32 / 输出 $1.98–3.96（$/百万 tokens）。缓存命中价为未命中价的约 2%。
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-line p-4">
            <div className="text-[13px] font-medium text-ink">非 DeepSeek 模型价格</div>
            <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
              单位为「元 / 百万 tokens」。不填时只统计 token，不估算费用；DeepSeek 模型无需在这里填写。
            </p>
            {externalModels.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-faint">
                当前没有其他 OpenAI 兼容模型。
              </p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {externalModels.map((item) => {
                  const draft = modelDrafts[item.key] ?? EMPTY_DRAFT;
                  return (
                    <div key={item.key} className="rounded-lg border border-line p-3">
                      <div className="flex items-center gap-1.5 text-[12px]">
                        <span className="font-medium text-ink">{item.modelName}</span>
                        <span className="text-faint">·</span>
                        <span className="text-muted">{item.providerName}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label="峰时输入">
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={draft.peakInput}
                            onChange={(e) =>
                              updatePriceDraft(item.key, { peakInput: e.target.value })
                            }
                            className="h-7 text-[11.5px]"
                          />
                        </Field>
                        <Field label="峰时输出">
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={draft.peakOutput}
                            onChange={(e) =>
                              updatePriceDraft(item.key, { peakOutput: e.target.value })
                            }
                            className="h-7 text-[11.5px]"
                          />
                        </Field>
                        <Field label="谷时输入">
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={draft.offpeakInput}
                            onChange={(e) =>
                              updatePriceDraft(item.key, { offpeakInput: e.target.value })
                            }
                            className="h-7 text-[11.5px]"
                          />
                        </Field>
                        <Field label="谷时输出">
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={draft.offpeakOutput}
                            onChange={(e) =>
                              updatePriceDraft(item.key, { offpeakOutput: e.target.value })
                            }
                            className="h-7 text-[11.5px]"
                          />
                        </Field>
                      </div>
                    </div>
                  );
                })}
                <Button size="sm" variant="primary" onClick={() => void saveModelPrices()}>
                  保存非 DeepSeek 价格
                </Button>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl border border-line px-4 py-3">
            <div className="text-[11.5px] text-faint">
              已读取 {logs.length} 条记录
              {summary.compactTokens > 0 &&
                ` · 上下文压缩 ${formatTokens(summary.compactTokens)}`}
              {summary.memoryTokens > 0 &&
                ` · 记忆提取 ${formatTokens(summary.memoryTokens)}`}
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Eraser size={13} />}
              onClick={() => void clearLogs()}
            >
              清除用量记录
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
