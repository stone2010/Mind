import type { Attachment, Conversation, Theme } from "../types";

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function groupLabel(ts: number): "今天" | "昨天" | "最近七天" | "更早" {
  const today = startOfToday();
  const day = 86400000;
  if (ts >= today) return "今天";
  if (ts >= today - day) return "昨天";
  if (ts >= today - 7 * day) return "最近七天";
  return "更早";
}

export interface ConversationGroups {
  pinned: Conversation[];
  groups: { label: string; items: Conversation[] }[];
}

export function groupConversations(list: Conversation[]): ConversationGroups {
  const pinned = list.filter((c) => c.pinned && !c.archived);
  const rest = list.filter((c) => !c.pinned && !c.archived);
  const buckets = new Map<string, Conversation[]>();
  for (const c of rest) {
    const label = groupLabel(c.updatedAt);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(c);
  }
  const order = ["今天", "昨天", "最近七天", "更早"];
  return {
    pinned,
    groups: order
      .filter((o) => buckets.has(o))
      .map((o) => ({ label: o, items: buckets.get(o)! })),
  };
}

export function deriveTitle(text: string, fallback = "新对话"): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > 32 ? `${clean.slice(0, 32)}…` : clean;
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function parseAttachments(raw?: string | null): Attachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Attachment[]) : [];
  } catch {
    return [];
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
