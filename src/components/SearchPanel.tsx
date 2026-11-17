import { ChevronDown, Globe2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { api } from "../lib/bridge";
import type { SearchSource } from "../types";

export interface LiveSearch {
  queries: string[];
  status: "searching" | "sources" | "error";
  error?: string;
}

export function parseSources(raw?: string | null): SearchSource[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SearchSource =>
        !!item && typeof item.url === "string" && item.url.length > 0,
    );
  } catch {
    return [];
  }
}

export function SearchPanel({
  sources,
  live,
}: {
  sources: SearchSource[];
  live?: LiveSearch | null;
}) {
  const searching = live?.status === "searching";
  const error = live?.status === "error" ? live.error : undefined;
  const [open, setOpen] = useState(!!searching);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (searching) {
      setOpen(true);
      setTouched(false);
    }
  }, [searching]);

  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);

  useEffect(() => {
    if (!searching && !error && sources.length > 0 && !touched) {
      setOpen(false);
    }
  }, [searching, error, sources.length, touched]);

  if (!searching && !error && sources.length === 0) return null;

  const label = searching
    ? "正在联网搜索…"
    : error
      ? "联网搜索未完成"
      : `已联网搜索 · ${sources.length} 个来源`;

  return (
    <div className="mb-2.5 overflow-hidden rounded-lg border border-line bg-sidebar">
      <button
        onClick={() => {
          setTouched(true);
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-muted hover:text-ink"
      >
        {searching ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
        ) : (
          <Globe2 size={13} className={clsx("shrink-0", error ? "text-danger" : "text-accent")} />
        )}
        <span className="flex-1">{label}</span>
        <ChevronDown
          size={13}
          className={clsx("transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2.5">
          {live && live.queries.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {live.queries.map((query) => (
                <span
                  key={query}
                  className="max-w-full truncate rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-muted"
                  title={query}
                >
                  {query}
                </span>
              ))}
            </div>
          )}

          {error && (
            <p className="mb-2 text-[11.5px] leading-5 text-danger">{error}</p>
          )}

          <div className="space-y-1">
            {sources.map((source) => (
              <button
                key={source.url}
                onClick={() => {
                  api.openExternal(source.url).catch(() => {});
                }}
                className="flex w-full gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-hover"
                title={source.url}
              >
                <Globe2 size={13} className="mt-[3px] shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-[12.5px] font-medium text-ink">
                    {source.title || source.url}
                  </span>
                  {(source.siteName || source.publishedAt) && (
                    <span className="mt-0.5 block truncate text-[11px] text-faint">
                      {[source.siteName, source.publishedAt].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {source.snippet && (
                    <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-[1.55] text-muted">
                      {source.snippet}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
