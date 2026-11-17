import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import { useConfirm } from "../store/confirm";
import { useToasts, type ToastItem } from "../store/toast";
import { Button, Modal } from "./ui";

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [expanded, setExpanded] = useState(false);
  const Icon =
    toast.kind === "error" ? AlertCircle : toast.kind === "success" ? CheckCircle2 : Info;

  return (
    <div
      className={clsx(
        "pointer-events-auto w-[min(440px,90vw)] rounded-lg border bg-elevated px-3.5 py-2.5 shadow-pop animate-fade-up",
        toast.kind === "error" ? "border-danger/30" : "border-line",
      )}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <Icon
          size={15}
          className={clsx(
            "mt-[2px] shrink-0",
            toast.kind === "error"
              ? "text-danger"
              : toast.kind === "success"
                ? "text-success"
                : "text-accent",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] leading-5 text-ink">{toast.title}</div>
          <div className="flex items-center gap-3">
            {toast.action && (
              <button
                className="mt-0.5 text-[11.5px] font-medium text-accent hover:underline"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            {toast.detail && (
              <button
                className="mt-0.5 text-[11.5px] text-faint hover:text-muted"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "收起详情" : "查看详情"}
              </button>
            )}
          </div>
          {expanded && toast.detail && (
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-sidebar p-2 font-mono text-[11px] leading-4 text-muted">
              {toast.detail}
            </pre>
          )}
        </div>
        <button
          onClick={() => dismiss(toast.id)}
          className="rounded p-0.5 text-faint hover:bg-hover hover:text-ink"
          aria-label="关闭提示"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[95] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

export function ConfirmHost() {
  const { options, close } = useConfirm();
  return (
    <Modal
      open={!!options}
      onClose={() => close(false)}
      title={options?.title ?? ""}
      description={options?.body}
      width={400}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {options?.cancelLabel ?? "取消"}
          </Button>
          <Button
            variant={options?.danger ? "danger" : "primary"}
            onClick={() => close(true)}
          >
            {options?.confirmLabel ?? "确定"}
          </Button>
        </>
      }
    />
  );
}
