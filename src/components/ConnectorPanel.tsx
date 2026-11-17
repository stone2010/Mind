import {
  Ban,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  Plug,
  X,
} from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import type { ConnectorCall, ConnectorCallStatus } from "../types";

const LABELS: Record<ConnectorCallStatus, string> = {
  pending: "等待授权",
  running: "运行中",
  done: "已完成",
  error: "失败",
  denied: "已拒绝",
};

function StatusIcon({ status }: { status: ConnectorCallStatus }) {
  switch (status) {
    case "pending":
      return <Clock size={12.5} className="text-[#e0a53a]" />;
    case "running":
      return <Loader2 size={12.5} className="animate-spin text-accent" />;
    case "done":
      return <Check size={12.5} className="text-success" />;
    case "denied":
      return <Ban size={12.5} className="text-faint" />;
    case "error":
      return <X size={12.5} className="text-danger" />;
  }
}

export function parseConnectorCalls(raw?: string | null): ConnectorCall[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ConnectorCall =>
        !!item &&
        typeof item === "object" &&
        typeof (item as ConnectorCall).callId === "string" &&
        typeof (item as ConnectorCall).tool === "string",
    );
  } catch {
    return [];
  }
}

export function ConnectorPanel({ calls }: { calls: ConnectorCall[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (calls.length === 0) return null;
  const active = calls.some((c) => c.status === "pending" || c.status === "running");

  return (
    <div className="mb-2.5 overflow-hidden rounded-lg border border-line bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted">
        <Plug size={13} className={clsx("shrink-0", active && "text-accent")} />
        <span className="flex-1">
          工具调用 · {calls.length}
          {active && <span className="ml-1.5 text-accent">进行中</span>}
        </span>
      </div>
      <div className="border-t border-line">
        {calls.map((call) => {
          const open = openId === call.callId;
          const detail =
            call.error ??
            call.result ??
            (call.arguments != null ? JSON.stringify(call.arguments, null, 2) : "");
          return (
            <div key={call.callId} className="border-b border-line last:border-b-0">
              <button
                onClick={() => setOpenId(open ? null : call.callId)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover/60"
              >
                <StatusIcon status={call.status} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                  {call.server}
                  <span className="mx-1 text-faint">/</span>
                  <span className="font-mono text-[11.5px] text-muted">{call.tool}</span>
                </span>
                <span
                  className={clsx(
                    "shrink-0 text-[11px]",
                    call.status === "error"
                      ? "text-danger"
                      : call.status === "done"
                        ? "text-success"
                        : "text-faint",
                  )}
                >
                  {LABELS[call.status]}
                </span>
                <ChevronDown
                  size={12}
                  className={clsx(
                    "shrink-0 text-faint transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open && (
                <div className="px-3 pb-2.5">
                  {call.arguments != null && (
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-panel px-2 py-1.5 font-mono text-[10.5px] leading-4 text-muted">
                      {JSON.stringify(call.arguments, null, 2)}
                    </pre>
                  )}
                  {call.result && (
                    <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-panel px-2 py-1.5 font-mono text-[10.5px] leading-4 text-muted">
                      {call.result}
                    </pre>
                  )}
                  {call.error && !call.result && (
                    <p className="mt-1 text-[11.5px] leading-5 text-danger">{call.error}</p>
                  )}
                  {!detail && <p className="text-[11.5px] text-faint">暂无详情</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
