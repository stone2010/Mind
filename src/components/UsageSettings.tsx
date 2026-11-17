import { BarChart3, Eraser, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/bridge";
import { useAppStore } from "../store/app";
import { confirmDialog } from "../store/confirm";
import { pushToast } from "../store/toast";
import type { UsageLogEntry } from "../types";
import { Button, Field, Input, Switch } from "./ui";

function parseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

function isOffpeak(timestamp: number, start: string, end: string): boolean {
  const date = new Date(timestamp);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const from = parseTime(start);
  const to = parseTime(end);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

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

export function UsageSettings() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const enabled = settings.usageEnabled;

  const [logs, setLogs] = useState<UsageLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [priceDraft, setPriceDraft] = useState({
    peakInput: String(settings.peakInputPrice),
    peakOutput: String(settings.peakOutputPrice),
    offpeakInput: String(settings.offpeakInputPrice),
    offpeakOutput: String(settings.offpeakOutputPrice),
    start: settings.offpeakStart,
    end: settings.offpeakEnd,
  });

  useEffect(() => {
    setPriceDraft({
      peakInput: String(settings.peakInputPrice),
      peakOutput: String(settings.peakOutputPrice),
      offpeakInput: String(settings.offpeakInputPrice),
      offpeakOutput: String(settings.offpeakOutputPrice),
      start: settings.offpeakStart,
      end: settings.offpeakEnd,
    });
  }, [
    settings.peakInputPrice,
    settings.peakOutputPrice,
    settings.offpeakInputPrice,
    settings.offpeakOutputPrice,
    settings.offpeakStart,
    settings.offpeakEnd,
  ]);

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

  const aggregate = useMemo(() => {
    const prices = {
      peakInput: settings.peakInputPrice,
      peakOutput: settings.peakOutputPrice,
      offpeakInput: settings.offpeakInputPrice,
      offpeakOutput: settings.offpeakOutputPrice,
    };
    const hasPrice =
      prices.peakInput > 0 ||
      prices.peakOutput > 0 ||
      prices.offpeakInput > 0 ||
      prices.offpeakOutput > 0;
    let prompt = 0;
    let completion = 0;
    let total = 0;
    let peakTokens = 0;
    let offpeakTokens = 0;
    let peakCost = 0;
    let offpeakCost = 0;
    let compactTokens = 0;
    let memoryTokens = 0;
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (13 - index));
      return {
        key: dayKey(date.getTime()),
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        peak: 0,
        offpeak: 0,
      };
    });
    const byDay = new Map(days.map((day) => [day.key, day]));

    for (const log of logs) {
      const offpeak = isOffpeak(
        log.createdAt,
        settings.offpeakStart,
        settings.offpeakEnd,
      );
      const tokens = log.totalTokens || log.promptTokens + log.completionTokens;
      const cost =
        (log.promptTokens / 1_000_000) *
          (offpeak ? prices.offpeakInput : prices.peakInput) +
        (log.completionTokens / 1_000_000) *
          (offpeak ? prices.offpeakOutput : prices.peakOutput);
      prompt += log.promptTokens;
      completion += log.completionTokens;
      total += tokens;
      if (log.kind === "compact") compactTokens += tokens;
      if (log.kind === "memory") memoryTokens += tokens;
      if (offpeak) {
        offpeakTokens += tokens;
        offpeakCost += cost;
      } else {
        peakTokens += tokens;
        peakCost += cost;
      }
      const day = byDay.get(dayKey(log.createdAt));
      if (day) {
        if (offpeak) day.offpeak += tokens;
        else day.peak += tokens;
      }
    }
    return {
      hasPrice,
      prompt,
      completion,
      total,
      peakTokens,
      offpeakTokens,
      peakCost,
      offpeakCost,
      totalCost: peakCost + offpeakCost,
      compactTokens,
      memoryTokens,
      days,
    };
  }, [
    logs,
    settings.peakInputPrice,
    settings.peakOutputPrice,
    settings.offpeakInputPrice,
    settings.offpeakOutputPrice,
    settings.offpeakStart,
    settings.offpeakEnd,
  ]);

  const savePricing = async () => {
    const parse = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(10000, parsed)) : 0;
    };
    const start = /^\d{2}:\d{2}$/.test(priceDraft.start)
      ? priceDraft.start
      : "00:30";
    const end = /^\d{2}:\d{2}$/.test(priceDraft.end) ? priceDraft.end : "08:30";
    await updateSettings({
      peakInputPrice: parse(priceDraft.peakInput),
      peakOutputPrice: parse(priceDraft.peakOutput),
      offpeakInputPrice: parse(priceDraft.offpeakInput),
      offpeakOutputPrice: parse(priceDraft.offpeakOutput),
      offpeakStart: start,
      offpeakEnd: end,
    });
    pushToast({ kind: "success", title: "峰谷时段与单价已保存" });
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

  const maxDay = Math.max(
    1,
    ...aggregate.days.map((day) => day.peak + day.offpeak),
  );

  return (
    <section>
      <div>
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
          用量与费用
        </h2>
        <p className="mt-1 text-[12.5px] leading-5 text-muted">
          记录模型服务返回的真实 token 用量，并按你填写的峰谷单价估算费用。费用仅供预算参考，最终以服务商账单为准。
        </p>
      </div>

      <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-line p-4">
        <div>
          <div className="text-[13px] font-medium text-ink">记录并展示用量</div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">
            关闭后不再写入新的用量记录，也不显示看板；已有记录保留，可随时重新打开。
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
              value={formatTokens(aggregate.total)}
              sub={`输入 ${formatTokens(aggregate.prompt)} · 输出 ${formatTokens(aggregate.completion)}`}
            />
            <StatCard
              label="估算费用"
              value={aggregate.hasPrice ? formatMoney(aggregate.totalCost) : "未设置单价"}
              sub={
                aggregate.hasPrice
                  ? "按下方峰谷单价估算"
                  : "填写下方单价后显示费用"
              }
            />
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <StatCard
              label="峰时用量"
              value={formatTokens(aggregate.peakTokens)}
              sub={
                aggregate.hasPrice
                  ? `谷时以外 · 估算 ${formatMoney(aggregate.peakCost)}`
                  : "谷时以外 · 未设置单价"
              }
              tone="peak"
            />
            <StatCard
              label="谷时用量"
              value={formatTokens(aggregate.offpeakTokens)}
              sub={
                aggregate.hasPrice
                  ? `${settings.offpeakStart}–${settings.offpeakEnd} · 估算 ${formatMoney(aggregate.offpeakCost)}`
                  : `${settings.offpeakStart}–${settings.offpeakEnd} · 未设置单价`
              }
              tone="offpeak"
            />
          </div>

          <div className="mt-3 rounded-xl border border-line p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-ink">最近 14 天</div>
                <p className="mt-0.5 text-[11.5px] text-faint">
                  按本地时间统计；深色为峰时，浅色为谷时。
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
              {aggregate.days.map((day) => {
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
            {aggregate.total === 0 && (
              <p className="mt-3 text-center text-[11.5px] text-faint">
                还没有用量记录。发送一条真实模型消息后，这里会显示 token 消耗。
              </p>
            )}
          </div>

          <div className="mt-3 rounded-xl border border-line p-4">
            <div className="flex items-center gap-2">
              <Wallet size={14} className="text-accent" />
              <div className="text-[13px] font-medium text-ink">峰谷单价</div>
            </div>
            <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
              单价单位为「元 / 百万 tokens」。DeepSeek 的价格和优惠时段可能调整，请填入你账户当前适用的价格；全为 0 时只统计 token，不显示费用。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="峰时输入">
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={priceDraft.peakInput}
                  onChange={(e) =>
                    setPriceDraft({ ...priceDraft, peakInput: e.target.value })
                  }
                  className="h-8 text-[12.5px]"
                />
              </Field>
              <Field label="峰时输出">
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={priceDraft.peakOutput}
                  onChange={(e) =>
                    setPriceDraft({ ...priceDraft, peakOutput: e.target.value })
                  }
                  className="h-8 text-[12.5px]"
                />
              </Field>
              <Field label="谷时输入">
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={priceDraft.offpeakInput}
                  onChange={(e) =>
                    setPriceDraft({ ...priceDraft, offpeakInput: e.target.value })
                  }
                  className="h-8 text-[12.5px]"
                />
              </Field>
              <Field label="谷时输出">
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={priceDraft.offpeakOutput}
                  onChange={(e) =>
                    setPriceDraft({ ...priceDraft, offpeakOutput: e.target.value })
                  }
                  className="h-8 text-[12.5px]"
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="谷时开始">
                <Input
                  type="time"
                  value={priceDraft.start}
                  onChange={(e) =>
                    setPriceDraft({ ...priceDraft, start: e.target.value })
                  }
                  className="h-8 w-[110px] text-[12.5px]"
                />
              </Field>
              <Field label="谷时结束">
                <Input
                  type="time"
                  value={priceDraft.end}
                  onChange={(e) =>
                    setPriceDraft({ ...priceDraft, end: e.target.value })
                  }
                  className="h-8 w-[110px] text-[12.5px]"
                />
              </Field>
              <Button size="sm" variant="primary" onClick={() => void savePricing()}>
                保存设置
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-faint">
              默认谷时 00:30–08:30 只是常用预设，不代表服务商当前承诺；请以官方价格页为准。
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl border border-line px-4 py-3">
            <div className="text-[11.5px] text-faint">
              已读取 {logs.length} 条记录
              {aggregate.compactTokens > 0 &&
                ` · 上下文压缩 ${formatTokens(aggregate.compactTokens)}`}
              {aggregate.memoryTokens > 0 &&
                ` · 记忆提取 ${formatTokens(aggregate.memoryTokens)}`}
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
