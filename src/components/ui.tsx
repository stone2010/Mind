import { Loader2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

import logoUrl from "../assets/mind-logo.png";

const LOGO_ASPECT = 688 / 373;

export function Logo({
  height = 24,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <img
      src={logoUrl}
      alt="Mind"
      draggable={false}
      style={{
        height,
        width: Math.round(height * LOGO_ASPECT),
        maxWidth: "100%",
        flexShrink: 0,
      }}
      className={clsx("block select-none object-contain", className)}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-100 select-none disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";
  const sizes = {
    sm: "h-7 px-2.5 text-xs",
    md: "h-9 px-3.5 text-[13px]",
    lg: "h-11 px-5 text-sm",
  };
  const variants = {
    primary: "bg-accent text-white hover:bg-accent-hover dark:text-[#0b1530]",
    secondary: "border border-line bg-panel text-ink hover:bg-hover",
    ghost: "text-muted hover:bg-hover hover:text-ink",
    soft: "bg-accent-soft text-accent hover:brightness-95 dark:hover:brightness-110",
    danger: "bg-danger text-white hover:brightness-95",
  };
  return (
    <button
      className={clsx(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: "sm" | "md";
}

export function IconButton({
  label,
  active,
  size = "md",
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      title={label}
      aria-label={label}
      className={clsx(
        "inline-flex items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        active && "bg-active text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "h-9 w-full rounded-lg border border-line bg-panel px-3 text-[13.5px] text-ink placeholder:text-faint transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft",
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        "w-full resize-none rounded-lg border border-line bg-panel px-3 py-2 text-[13.5px] leading-6 text-ink placeholder:text-faint transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft",
        className,
      )}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between text-[12.5px] font-medium text-ink">
        {label}
        {hint && <span className="text-[11.5px] font-normal text-faint">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[11.5px] text-danger">{error}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        className={clsx(
          "absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[19px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-sidebar p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            "h-7 rounded-md px-3 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-panel text-ink shadow-sm"
              : "text-muted hover:text-ink",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const focusable = ref.current?.querySelector<HTMLElement>(
        "input, textarea, select, button",
      );
      focusable?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      previous?.focus?.();
    };
  }, [open]);

  const trapFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !ref.current) return;
    const nodes = Array.from(
      ref.current.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-3 sm:p-6 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width, maxWidth: "calc(100vw - 24px)" }}
        onKeyDown={trapFocus}
        className="max-h-[86dvh] overflow-y-auto rounded-xl border border-line bg-elevated p-5 shadow-modal animate-scale-in"
      >
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] leading-5 text-muted">{description}</p>}
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx("animate-spin", className)} />;
}

export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [ref, handler, active]);
}

export function Popover({
  open,
  onClose,
  anchor,
  children,
  align = "left",
  className,
  width,
}: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "left" | "right" | "top";
  className?: string;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useClickOutside(ref, onClose, open);

  useEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const w = width ?? 240;
      const height = ref.current?.offsetHeight ?? 0;
      let left = align === "right" ? rect.right - w : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = align === "top" ? rect.top - height - 6 : rect.bottom + 6;
      if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
      top = Math.max(8, top);
      setStyle({ left, top, width: w });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, anchor, align, width]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      style={style}
      className={clsx(
        "fixed z-[70] overflow-hidden rounded-lg border border-line bg-elevated p-1 shadow-pop animate-scale-in",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
