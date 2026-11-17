import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  separator?: boolean;
  onClick: () => void;
}

export function FloatingMenu({
  x,
  y,
  items,
  onClose,
  width = 188,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top, width }}
      className="fixed z-[75] rounded-lg border border-line bg-elevated p-1 shadow-pop animate-scale-in"
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && <div className="my-1 h-px bg-line" />}
          <button
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={clsx(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13px] transition-colors",
              item.danger
                ? "text-danger hover:bg-danger-soft"
                : "text-ink hover:bg-hover",
            )}
          >
            {item.icon && <span className="flex w-4 shrink-0 justify-center text-muted">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
