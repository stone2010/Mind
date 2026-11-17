import { MessageSquare, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { api } from "../lib/bridge";
import { useAppStore } from "../store/app";
import { useChatStore } from "../store/chat";
import type { SearchHit } from "../types";

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const conversations = useChatStore((s) => s.conversations);
  const openConversation = useChatStore((s) => s.openConversation);
  const setView = useAppStore((s) => s.setView);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setIndex(0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setIndex(0);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const results = await api.search(q);
        setHits(results);
        setIndex(0);
      } catch {
        setHits([]);
      }
    }, 140);
    return () => window.clearTimeout(t);
  }, [query, open]);

  if (!open) return null;

  const recent = conversations.filter((c) => !c.archived).slice(0, 6);
  const items = query.trim()
    ? hits.map((h) => ({ id: h.conversationId, title: h.title, snippet: h.snippet, kind: h.kind }))
    : recent.map((c) => ({ id: c.id, title: c.title, snippet: "", kind: "recent" as const }));

  const select = async (id: string) => {
    onClose();
    setView({ name: "chat" });
    await openConversation(id);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex items-start justify-center bg-black/30 px-6 pt-[13vh] animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-elevated shadow-modal animate-scale-in">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对话和消息内容…"
            className="h-12 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, items.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && items[index]) {
                void select(items[index].id);
              }
            }}
          />
          <button
            onClick={onClose}
            className="rounded p-1 text-faint hover:bg-hover hover:text-ink"
            aria-label="关闭搜索"
          >
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-[12.5px] text-faint">
              {query.trim() ? "没有找到匹配的对话。" : "还没有可以搜索的对话。"}
            </p>
          )}
          {items.map((item, i) => (
            <button
              key={`${item.id}-${i}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => void select(item.id)}
              className={clsx(
                "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left",
                i === index ? "bg-hover" : "",
              )}
            >
              <MessageSquare size={14} className="mt-[3px] shrink-0 text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{item.title}</span>
                {item.snippet && (
                  <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-4 text-faint">
                    {item.snippet}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10.5px] text-faint">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
