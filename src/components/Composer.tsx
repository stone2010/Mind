import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  FileText,
  Globe2,
  Paperclip,
  Plug,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { useAppStore } from "../store/app";
import { useChatStore } from "../store/chat";
import type { Attachment, ModelConfig, ProviderConfig } from "../types";
import { formatBytes } from "../lib/utils";
import { IconButton, Popover } from "./ui";

interface ModelOption {
  model: ModelConfig;
  provider: ProviderConfig;
}

export function Composer({
  draft,
  onDraftChange,
  attachments,
  onAttachmentsChange,
  onFiles,
  onSend,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  attachments: Attachment[];
  onAttachmentsChange: (list: Attachment[]) => void;
  onFiles: (files: FileList | File[]) => void;
  onSend: () => void;
}) {
  const streaming = useChatStore((s) => s.streaming !== null);
  const compacting = useChatStore((s) => s.compacting);
  const stopping = useChatStore((s) => s.stopping);
  const stop = useChatStore((s) => s.stop);
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const connectors = useAppStore((s) => s.connectors);
  const github = useAppStore((s) => s.github);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setModel = useAppStore((s) => s.setModel);
  const setView = useAppStore((s) => s.setView);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const [modelOpen, setModelOpen] = useState(false);

  const options: ModelOption[] = providers.flatMap((provider) =>
    provider.models.map((model) => ({ model, provider })),
  );
  const current =
    options.find((o) => o.model.id === settings.modelId && o.provider.id === settings.providerId) ??
    options.find((o) => o.model.id === settings.modelId) ??
    options[0];
  const supportsThinking = current?.model.supportsThinking ?? false;
  const supportsWebSearch =
    current?.provider.kind === "deepseek" &&
    current?.model.supportsWebSearch === true;
  const enabledConnectors = connectors.filter((c) => c.config.enabled);
  const githubReady = !!(github?.enabled && github.connected);
  const hasConnectorTools = enabledConnectors.length > 0 || githubReady;
  const canSend =
    (draft.trim().length > 0 || attachments.length > 0) && !streaming && !compacting;

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  useEffect(() => {
    if (!supportsThinking && settings.thinking) {
      updateSettings({ thinking: false });
    }
  }, [supportsThinking, settings.thinking, updateSettings]);

  useEffect(() => {
    if (!supportsWebSearch && settings.webSearch) {
      updateSettings({ webSearch: false });
    }
  }, [supportsWebSearch, settings.webSearch, updateSettings]);

  return (
    <div className="shrink-0 px-5 pb-4 pt-1">
      <div className="mx-auto w-full max-w-[780px]">
        <div className="rounded-2xl border border-line bg-panel transition-colors focus-within:border-line-strong">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {attachments.map((att, index) => (
                <div
                  key={`${att.name}-${index}`}
                  className="flex max-w-[230px] items-center gap-1.5 rounded-md border border-line bg-sidebar py-1 pl-1.5 pr-1 text-[11.5px] text-muted"
                  title={
                    att.kind === "text" && att.truncated
                      ? "内容较长，仅发送前 200,000 个字符"
                      : att.name
                  }
                >
                  {att.kind === "image" && att.dataUrl ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="h-6 w-6 rounded object-cover"
                    />
                  ) : (
                    <FileText size={12} className="shrink-0" />
                  )}
                  <span className="truncate">{att.name}</span>
                  <span className="shrink-0 text-faint">{formatBytes(att.size)}</span>
                  <button
                    className="rounded p-0.5 text-faint hover:bg-hover hover:text-ink"
                    onClick={() => onAttachmentsChange(attachments.filter((_, i) => i !== index))}
                    aria-label={`移除 ${att.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            id="composer-input"
            ref={taRef}
            value={draft}
            rows={1}
            placeholder="给 Mind 发送消息"
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            className="block max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14.5px] leading-[1.65] text-ink placeholder:text-faint"
          />

          <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".txt,.md,.markdown,.json,.csv,.tsv,.log,.xml,.yaml,.yml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.h,.cpp,.cs,.go,.rs,.sql,.toml,.ini,image/*"
              onChange={(e) => {
                if (e.target.files) onFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <IconButton label="添加附件" onClick={() => fileRef.current?.click()}>
              <Paperclip size={16} />
            </IconButton>

            <button
              ref={modelBtnRef}
              onClick={() => options.length > 1 && setModelOpen(true)}
              className={clsx(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors",
                options.length > 1 && "hover:bg-hover hover:text-ink",
              )}
              title={options.length > 1 ? "切换模型" : undefined}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="max-w-[160px] truncate">{current?.model.label ?? "DeepSeek"}</span>
              {options.length > 1 && <ChevronDown size={12} className="text-faint" />}
            </button>

            {supportsThinking && (
              <button
                onClick={() => updateSettings({ thinking: !settings.thinking })}
                title={settings.thinking ? "关闭深度思考" : "开启深度思考"}
                className={clsx(
                  "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
                  settings.thinking
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-hover hover:text-ink",
                )}
              >
                <Brain size={14} />
                <span className="hidden sm:inline">深度思考</span>
              </button>
            )}

            {supportsWebSearch && !settings.demoMode && (
              <button
                onClick={() => updateSettings({ webSearch: !settings.webSearch })}
                title="联网搜索（由 DeepSeek 提供，按次计费）"
                className={clsx(
                  "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
                  settings.webSearch
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-hover hover:text-ink",
                )}
              >
                <Globe2 size={14} />
                <span className="hidden sm:inline">联网搜索</span>
              </button>
            )}

            {hasConnectorTools && !settings.demoMode && (
              <button
                onClick={() => updateSettings({ connectors: !settings.connectors })}
                title="连接器与 GitHub：调用工具前都会请求你的确认"
                className={clsx(
                  "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
                  settings.connectors
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-hover hover:text-ink",
                )}
              >
                <Plug size={14} />
                <span className="hidden sm:inline">连接器</span>
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    githubReady || enabledConnectors.some((c) => c.connected)
                      ? "bg-success"
                      : "bg-faint",
                  )}
                />
              </button>
            )}

            <div className="flex-1" />

            {compacting ? (
              <span className="flex h-8 items-center gap-2 rounded-full border border-line bg-sidebar px-3 text-[11.5px] text-muted">
                <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-line-strong border-t-accent" />
                正在压缩上下文…
              </span>
            ) : streaming ? (
              <button
                onClick={stop}
                disabled={stopping}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-sidebar text-ink transition-colors hover:bg-hover disabled:opacity-50"
                aria-label="停止生成"
                title="停止生成"
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={onSend}
                disabled={!canSend}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:bg-sidebar disabled:text-faint dark:text-[#0b1530]"
                aria-label="发送"
                title="发送 (Enter)"
              >
                <ArrowUp size={16} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-faint">
          {compacting
            ? "正在压缩较早的对话，完成后会自动继续发送"
            : settings.demoMode
              ? "演示模式：回复由本地模拟生成，并非真实 AI 输出"
              : "内容由 AI 生成，请核对重要信息"}
        </p>
      </div>

      <Popover
        open={modelOpen}
        onClose={() => setModelOpen(false)}
        anchor={modelBtnRef}
        align="left"
        width={264}
      >
        <div className="px-2 py-1 text-[11px] text-faint">选择模型</div>
        {providers.map((provider) => (
          <div key={provider.id} className="mb-0.5">
            <div className="px-2 pb-0.5 pt-1 text-[10.5px] uppercase tracking-wide text-faint">
              {provider.name}
            </div>
            {provider.models.map((model) => {
              const active =
                settings.modelId === model.id && settings.providerId === provider.id;
              return (
                <button
                  key={`${provider.id}-${model.id}`}
                  onClick={async () => {
                    setModelOpen(false);
                    await setModel(provider.id, model.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-left text-[12.5px] text-ink hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate">{model.label}</span>
                  {model.supportsThinking && (
                    <span
                      className="rounded border border-line px-1 text-[9.5px] text-faint"
                      title="支持深度思考"
                    >
                      思考
                    </span>
                  )}
                  {active && <Check size={13} className="text-accent" />}
                </button>
              );
            })}
          </div>
        ))}
        <div className="my-1 h-px bg-line" />
        <button
          onClick={() => {
            setModelOpen(false);
            setView({ name: "settings", section: "developer" });
          }}
          className="w-full rounded-md px-2 py-[6px] text-left text-[12px] text-muted hover:bg-hover hover:text-ink"
        >
          管理模型提供商…
        </button>
      </Popover>
    </div>
  );
}
