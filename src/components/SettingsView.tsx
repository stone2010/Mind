import {
  ArrowLeft,
  Brain,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  DatabaseBackup,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  Info,
  Link2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/bridge";
import { isMobilePlatform } from "../lib/platform";
import { useIsMobileLayout } from "../lib/useIsMobile";
import { copyText } from "../lib/utils";
import { modelLabel, useAppStore, type SettingsSection } from "../store/app";
import { useChatStore } from "../store/chat";
import { confirmDialog } from "../store/confirm";
import { pushToast } from "../store/toast";
import type { AppInfo, ChatTurn, Memory, TestResult } from "../types";
import { ConnectorSettings } from "./ConnectorSettings";
import { DataSettings } from "./DataSettings";
import { DeveloperSettings } from "./DeveloperSettings";
import { UsageSettings } from "./UsageSettings";
import { Button, Field, IconButton, Input, Modal, Segmented, Switch, Textarea } from "./ui";

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <p className="mt-1 text-[12.5px] leading-5 text-muted">{description}</p>
    </div>
  );
}

function StatusDot({ tone }: { tone: "ok" | "warn" | "off" }) {
  return (
    <span
      className={clsx(
        "inline-block h-1.5 w-1.5 rounded-full",
        tone === "ok" && "bg-success",
        tone === "warn" && "bg-[#e0a53a]",
        tone === "off" && "bg-faint",
      )}
    />
  );
}

const CONTEXT_PRESETS = [
  { value: 4000, label: "精简 · 4k" },
  { value: 8000, label: "平衡 · 8k" },
  { value: 16000, label: "较长 · 16k" },
  { value: 100000, label: "长上下文 · 100k" },
  { value: 0, label: "完整历史" },
];

function GeneralPanel() {
  const settings = useAppStore((s) => s.settings);
  const setTheme = useAppStore((s) => s.setTheme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [contextDraft, setContextDraft] = useState(String(settings.contextTokens));
  const [customDraft, setCustomDraft] = useState(settings.customInstructions ?? "");

  useEffect(() => {
    setContextDraft(String(settings.contextTokens));
  }, [settings.contextTokens]);

  useEffect(() => {
    setCustomDraft(settings.customInstructions ?? "");
  }, [settings.customInstructions]);

  const applyContext = (value: number) => {
    setContextDraft(String(value));
    if (value !== settings.contextTokens) {
      void updateSettings({ contextTokens: value });
    }
  };

  const commitContext = () => {
    if (!contextDraft.trim()) {
      setContextDraft(String(settings.contextTokens));
      return;
    }
    const parsed = Number(contextDraft);
    if (!Number.isFinite(parsed)) {
      setContextDraft(String(settings.contextTokens));
      return;
    }
    const clamped = Math.min(128000, Math.max(0, Math.round(parsed)));
    setContextDraft(String(clamped));
    if (clamped !== settings.contextTokens) {
      void updateSettings({ contextTokens: clamped });
    }
  };

  return (
    <section>
      <SectionHeader title="通用" description="外观、对话上下文与基础设置。" />
      <div className="mt-6 rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-ink">主题</div>
            <div className="mt-0.5 text-[12px] text-muted">跟随系统，或固定使用浅色 / 深色。</div>
          </div>
          <Segmented
            value={settings.theme}
            onChange={(v) => setTheme(v)}
            options={[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
          />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <div className="text-[12.5px] text-muted">发送消息</div>
          <div className="text-[12px] text-faint">
            Enter 发送 · Shift + Enter 换行
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-line p-4">
        <div className="text-[13px] font-medium text-ink">对话上下文</div>
        <p className="mt-0.5 text-[12px] leading-5 text-muted">
          普通对话每次只携带最近一段历史，越短越省 token。除你开启的长期记忆外，不会添加额外的系统提示词。
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CONTEXT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => applyContext(preset.value)}
              className={clsx(
                "h-7 rounded-lg border px-2.5 text-[11.5px] transition-colors",
                settings.contextTokens === preset.value
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-line text-muted hover:bg-hover hover:text-ink",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">自定义上限</span>
          <div className="w-[112px] shrink-0">
            <Input
              type="number"
              min={0}
              max={128000}
              step={1000}
              value={contextDraft}
              onChange={(e) => setContextDraft(e.target.value)}
              onBlur={commitContext}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitContext();
                  e.currentTarget.blur();
                }
              }}
              className="h-8 tabular-nums text-[12.5px]"
            />
          </div>
          <span className="text-[11.5px] text-faint">tokens · 输入 0 表示不限制</span>
        </div>
        <div className="mt-3 flex items-start justify-between gap-4 border-t border-line pt-3">
          <div>
            <div className="text-[12.5px] font-medium text-ink">自动压缩较早对话</div>
            <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
              超出上限时，用一次轻量模型调用把较早消息压成摘要；之后只发送摘要和最近消息。压缩本身会产生少量 token。
            </p>
          </div>
          <Switch
            checked={settings.autoCompress}
            label="自动压缩较早对话"
            onChange={(value) => updateSettings({ autoCompress: value })}
          />
        </div>
        <p className="mt-2 text-[11.5px] leading-5 text-faint">
          按字符保守估算，实际计费以模型服务商为准。深度思考、联网搜索、连接器、自动记忆和自动压缩会产生额外 token。
        </p>
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[12.5px] font-medium text-ink">主动澄清</div>
              <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
                信息不足时，先向你确认（选择题 / 填空题），再给出回答。
              </p>
            </div>
            <Switch
              checked={settings.clarify}
              label="主动澄清"
              onChange={(value) => updateSettings({ clarify: value })}
            />
          </div>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <div className="text-[12.5px] font-medium text-ink">主动可视化</div>
              <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
                涉及比较、趋势、流程时，自动使用 Mermaid 图或数据图表。
              </p>
            </div>
            <Switch
              checked={settings.visualHints}
              label="主动可视化"
              onChange={(value) => updateSettings({ visualHints: value })}
            />
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-line p-4">
          <div className="text-[13px] font-medium text-ink">自定义指令</div>
          <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
            附加在系统提示词末尾，例如「始终用简体中文回答」「代码风格偏好 Rust 惯用法」。
            留空则使用默认行为。
          </p>
          <div className="mt-2.5">
            <Textarea
              rows={3}
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={() => {
                const value = customDraft.trim();
                const current = settings.customInstructions ?? "";
                if (value !== current) void updateSettings({ customInstructions: value });
              }}
              placeholder="例如：回答时使用列表；代码注释用中文"
            />
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-line p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium text-ink">聊天娱乐模式</div>
              <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
                让回复像朋友一样简短、口语、好玩，主要用来省 token。
                <strong className="text-[#b07a1c] dark:text-[#e0b35a]">
                  不适合当作生产力使用
                </strong>
                ，重要或专业问题请切回正常模式。开启后聊天框才会出现「聊天」按钮。
              </p>
            </div>
            <Switch
              checked={settings.chatMode}
              label="聊天娱乐模式"
              onChange={(value) => {
                if (value && !settings.chatModeAck) {
                  void confirmDialog({
                    title: "开启聊天娱乐模式？",
                    body: "这个模式让回复像朋友一样简短、口语、好玩，主要用来省 token，不适合当作生产力使用。",
                    confirmLabel: "开启",
                    danger: false,
                  }).then((ok) => {
                    if (ok) void updateSettings({ chatMode: true, chatModeAck: true });
                  });
                } else {
                  void updateSettings({ chatMode: value });
                }
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ModelPanel() {
  const mobile = isMobilePlatform();
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const keyPresent = useAppStore((s) => s.keyPresent);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const refreshKeyStatus = useAppStore((s) => s.refreshKeyStatus);
  const requestOnboarding = useAppStore((s) => s.requestOnboarding);

  const provider =
    providers.find((p) => p.id === settings.providerId) ?? providers[0];
  const modelId =
    provider?.models.find((m) => m.id === settings.modelId)?.id ??
    provider?.models[0]?.id ??
    settings.modelId;
  const connected = provider ? !!keyPresent[provider.id] : false;
  const isDemo = settings.demoMode;

  const [changing, setChanging] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<{ message: string; detail?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    setTestResult(null);
  }, [provider?.id]);

  if (!provider) {
    return (
      <section>
        <SectionHeader title="模型连接" description="连接一个模型服务后即可开始对话。" />
        <div className="mt-6 rounded-xl border border-line p-4">
          <p className="text-[13px] text-muted">当前没有可用的模型提供商。</p>
          <Button
            variant="primary"
            size="sm"
            className="mt-3"
            onClick={() => requestOnboarding("missing-key")}
          >
            重新连接 DeepSeek
          </Button>
        </div>
      </section>
    );
  }

  const doTest = async () => {
    setTesting(true);
    setTestResult(null);
    setDetailOpen(false);
    try {
      const result = await api.providerTest(provider, modelId);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: { code: "unknown", message: "无法测试连接", detail: errorMessage(err) },
      });
    } finally {
      setTesting(false);
    }
  };

  const saveKey = async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) {
      setKeyError({ message: "请输入 API Key。" });
      return;
    }
    if (trimmed.length < 8 || /\s/.test(trimmed)) {
      setKeyError({ message: "API Key 格式看起来不正确，请检查是否完整复制。" });
      return;
    }
    setSaving(true);
    setKeyError(null);
    try {
      const result = await api.providerTest(provider, modelId, trimmed);
      if (!result.ok) {
        setKeyError({
          message: result.error?.message ?? "API Key 无效。",
          detail: result.error?.detail,
        });
        setSaving(false);
        return;
      }
      await api.credentialSave(provider.id, trimmed);
      await refreshKeyStatus();
      setSaving(false);
      setChanging(false);
      setKeyDraft("");
      await updateSettings({ demoMode: false });
      pushToast({
        kind: "success",
        title: mobile
          ? "已连接，API Key 仅保存在本次运行的内存中"
          : "已连接，API Key 已保存到 Windows 凭据管理器",
      });
    } catch (err) {
      setSaving(false);
      setKeyError({ message: "保存失败，请稍后再试。", detail: errorMessage(err) });
    }
  };

  const removeConnection = async () => {
    const ok = await confirmDialog({
      title: "移除已保存的 API Key？",
      body: "移除后需要重新填写 API Key 才能继续对话。聊天记录不会被删除。",
      confirmLabel: "移除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.credentialDelete(provider.id);
      await refreshKeyStatus();
      pushToast({
        kind: "success",
        title: mobile ? "已从内存中移除 API Key" : "已从 Windows 凭据管理器中移除 API Key",
      });
    } catch (err) {
      pushToast({ kind: "error", title: "移除失败", detail: errorMessage(err) });
    }
  };

  return (
    <section>
      <SectionHeader
        title="模型连接"
        description="Mind 默认使用 DeepSeek 官方 API，你只需要提供 API Key。"
      />

      <div className="mt-6 rounded-xl border border-line p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Cpu size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium text-ink">{provider.name}</span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <StatusDot tone={isDemo ? "warn" : connected ? "ok" : "off"} />
                {isDemo ? "演示模式" : connected ? "已连接" : "未连接"}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted">
              {isDemo
                ? "回复由本地模拟生成，不会请求网络，也不会产生费用。"
                : connected
                  ? mobile
                    ? "API Key 只保存在本次运行的内存中，仅用于直接连接该服务；重启后需重新输入。"
                    : "API Key 已安全保存在 Windows 凭据管理器中，仅用于直接连接该服务。"
                  : "尚未保存 API Key。填写后即可开始对话。"}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setChanging(true)}>
            更换 API Key
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={13} />}
            loading={testing}
            onClick={doTest}
            disabled={!connected}
          >
            测试连接
          </Button>
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              onClick={removeConnection}
            >
              移除连接
            </Button>
          )}
          {!connected && !isDemo && (
            <Button
              size="sm"
              variant="soft"
              onClick={() => requestOnboarding("missing-key")}
            >
              重新连接 DeepSeek
            </Button>
          )}
        </div>

        {testResult && (
          <div
            className={clsx(
              "mt-3 rounded-lg px-3 py-2 text-[12px] leading-5",
              testResult.ok
                ? "border border-success/25 bg-success/5 text-success"
                : "border border-danger/25 bg-danger-soft text-danger",
            )}
          >
            {testResult.ok ? (
              <span className="flex items-center gap-1.5">
                <Check size={13} /> 连接成功 · {testResult.latencyMs} ms
              </span>
            ) : (
              <div>
                <div className="flex items-start gap-1.5">
                  <X size={13} className="mt-[3px] shrink-0" />
                  <span>{testResult.error?.message ?? "连接失败"}</span>
                </div>
                {testResult.error?.detail && (
                  <>
                    <button
                      className="mt-0.5 text-[11px] text-danger/75 hover:text-danger"
                      onClick={() => setDetailOpen((v) => !v)}
                    >
                      {detailOpen ? "收起详细错误" : "查看详细错误"}
                    </button>
                    {detailOpen && (
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-panel/70 p-2 font-mono text-[10.5px] leading-4 text-muted">
                        {testResult.error.detail}
                      </pre>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-line p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-ink">演示模式</div>
            <p className="mt-0.5 text-[12px] leading-5 text-muted">
              不连接网络，用本地模拟回复体验完整界面。所有模拟回复都会带有「演示模式」标识。
            </p>
          </div>
          <Switch
            checked={isDemo}
            onChange={async (value) => {
              if (!value && !connected) {
                pushToast({
                  kind: "error",
                  title: "请先填写 API Key，再关闭演示模式。",
                });
                return;
              }
              await updateSettings({ demoMode: value });
            }}
          />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-line p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-ink">当前模型</div>
            <p className="mt-0.5 text-[12px] text-muted">
              {modelLabel(settings.modelId) || settings.modelId}
              {isDemo ? "（演示）" : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              useAppStore.getState().setView({ name: "settings", section: "developer" })
            }
          >
            查看更多模型
          </Button>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-5 text-faint">
        <ShieldCheck size={13} className="mt-[3px] shrink-0" />
        {mobile
          ? "API Key 只保存在本次运行的内存中，不会写入聊天数据库或配置文件，也不会发送给 Mind；重启应用后需要重新输入。"
          : "API Key 仅保存在本机的 Windows 凭据管理器中，不会写入聊天数据库或配置文件，也不会发送给 Mind。"}
      </p>

      <Modal
        open={changing}
        onClose={() => {
          setChanging(false);
          setKeyError(null);
          setKeyDraft("");
        }}
        title="更换 API Key"
        description="保存前会真实发起一次模型请求，确认密钥可用。"
        width={440}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setChanging(false);
                setKeyError(null);
                setKeyDraft("");
              }}
            >
              取消
            </Button>
            <Button variant="primary" loading={saving} onClick={saveKey}>
              保存
            </Button>
          </>
        }
      >
        <Field label="API Key" hint="仅保存在本机">
          <div className="relative">
            <Input
              type={showKey ? "text" : "password"}
              value={keyDraft}
              onChange={(e) => {
                setKeyDraft(e.target.value);
                setKeyError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) void saveKey();
              }}
              placeholder="请输入新的 API Key"
              autoComplete="off"
              spellCheck={false}
              className="pr-10 font-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-1 top-0.5 flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
              aria-label={showKey ? "隐藏密钥" : "显示密钥"}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
        {keyError && (
          <div className="mt-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            <div>{keyError.message}</div>
            {keyError.detail && (
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-4 text-muted">
                {keyError.detail}
              </pre>
            )}
          </div>
        )}
        <button
          className="mt-3 text-[12px] text-accent hover:underline"
          onClick={() =>
            api.openExternal("https://platform.deepseek.com/api_keys").catch(() => {})
          }
        >
          如何获取 API Key
        </button>
      </Modal>
    </section>
  );
}

function MemoryPanel() {
  const settings = useAppStore((s) => s.settings);
  const memories = useAppStore((s) => s.memories);
  const refreshMemories = useAppStore((s) => s.refreshMemories);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const activeId = useChatStore((s) => s.activeId);
  const messagesMap = useChatStore((s) => s.messages);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Memory | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [query, setQuery] = useState("");

  const canExtract =
    !!activeId &&
    (messagesMap[activeId] ?? []).some(
      (m) => (m.role === "user" || m.role === "assistant") && m.content.trim(),
    );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleMemories = normalizedQuery
    ? memories.filter((m) => m.content.toLowerCase().includes(normalizedQuery))
    : memories;

  const extractFromConversation = async () => {
    const chat = useChatStore.getState();
    const id = chat.activeId;
    const list = id ? chat.messages[id] ?? [] : [];
    const turns: ChatTurn[] = list
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") && m.content.trim(),
      )
      .map((m) => ({ role: m.role, content: m.content, images: [] }));
    if (!id || turns.length === 0) {
      pushToast({ kind: "info", title: "当前对话还没有可提取的内容。" });
      return;
    }
    setExtracting(true);
    try {
      const added = await api.memoryAutoExtract(
        settings.providerId,
        settings.modelId,
        id,
        turns,
      );
      await refreshMemories();
      pushToast(
        added.length > 0
          ? {
              kind: "success",
              title: `已从当前对话记住 ${added.length} 条信息`,
              detail: "之后的对话会自动使用这些记忆。",
            }
          : {
              kind: "info",
              title: "没有发现新的长期记忆",
              detail: "现有的记忆已经覆盖了这段对话，或内容不值得长期保存。",
            },
      );
    } catch (err) {
      pushToast({
        kind: "error",
        title: "提取记忆失败",
        detail: errorMessage(err),
      });
    } finally {
      setExtracting(false);
    }
  };

  const add = async () => {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      await api.createMemory(content);
      await refreshMemories();
      setDraft("");
    } catch (err) {
      pushToast({ kind: "error", title: "添加失败", detail: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.updateMemory(editing.id, editDraft.trim());
      await refreshMemories();
      setEditing(null);
    } catch (err) {
      pushToast({ kind: "error", title: "保存失败", detail: errorMessage(err) });
    }
  };

  const remove = async (memory: Memory) => {
    const ok = await confirmDialog({
      title: "删除这条记忆？",
      body: "删除后，它不会再被附加到新的对话中。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteMemory(memory.id);
      await refreshMemories();
    } catch (err) {
      pushToast({ kind: "error", title: "删除失败", detail: errorMessage(err) });
    }
  };

  return (
    <section>
      <SectionHeader
        title="记忆"
        description="记录你希望 Mind 长期记住的信息：可以手动添加、在消息下点书签保存，也可以让 Mind 在对话后自动提取。"
      />

      <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-line p-4">
        <div>
          <div className="text-[13px] font-medium text-ink">自动记忆</div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">
            每次回复后自动提取值得长期记住的信息（称呼、偏好、长期项目等）。会额外调用一次模型
            （DeepSeek 默认使用 Flash），可能产生少量费用；内容只保存在本机。
            它与下方「在对话中使用记忆」相互独立：即使关闭注入，也会继续积累。
          </p>
          {settings.demoMode && (
            <p className="mt-1 text-[11.5px] text-faint">演示模式下不会执行自动记忆。</p>
          )}
        </div>
        <Switch
          checked={settings.autoMemory}
          onChange={(value) => updateSettings({ autoMemory: value })}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-line p-4">
        <div>
          <div className="text-[13px] font-medium text-ink">在对话中使用记忆</div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">
            仅控制是否把已保存的记忆附加到新对话；关闭后仍可继续自动提取和手动管理。
          </p>
        </div>
        <Switch
          checked={settings.longTermMemory}
          onChange={(value) => updateSettings({ longTermMemory: value })}
        />
      </div>

      <div className="mt-3 rounded-xl border border-line p-4">
        <div className="text-[13px] font-medium text-ink">记忆注入方式</div>
        <p className="mt-0.5 text-[12px] leading-5 text-muted">
          最近模式注入最近的记忆；相关模式按当前问题挑最相关的记忆，更省 token、更准。
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button
            onClick={() => updateSettings({ memoryRecall: "recent" })}
            className={clsx(
              "h-7 rounded-lg border px-2.5 text-[11.5px] transition-colors",
              settings.memoryRecall === "recent"
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-line text-muted hover:bg-hover hover:text-ink",
            )}
          >
            最近记忆
          </button>
          <button
            onClick={() => updateSettings({ memoryRecall: "recall" })}
            className={clsx(
              "h-7 rounded-lg border px-2.5 text-[11.5px] transition-colors",
              settings.memoryRecall === "recall"
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-line text-muted hover:bg-hover hover:text-ink",
            )}
          >
            相关记忆（省 token）
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-ink">从当前对话补记</div>
            <p className="mt-0.5 text-[12px] leading-5 text-muted">
              立即分析当前对话并提取长期信息。适合刚开启记忆、或想补回之前已经聊过的内容。
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Sparkles size={13} />}
            loading={extracting}
            disabled={!canExtract || settings.demoMode}
            onClick={() => void extractFromConversation()}
          >
            立即提取
          </Button>
        </div>
        {!canExtract && (
          <p className="mt-2 text-[11px] text-faint">先打开一个有消息的对话，再回到这里提取。</p>
        )}
        {settings.demoMode && (
          <p className="mt-2 text-[11px] text-faint">演示模式不调用模型，无法提取记忆。</p>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-line p-4">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="例如：请始终用简体中文回答；我是一名产品经理。"
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={13} />}
            loading={saving}
            disabled={!draft.trim()}
            onClick={add}
          >
            添加记忆
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-medium text-ink">
          全部记忆
          <span className="ml-1.5 text-[12px] font-normal text-faint">{memories.length}</span>
        </div>
        {memories.length > 0 && (
          <div className="relative w-full sm:w-[220px]">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索记忆"
              className="h-8 pl-8 text-[12px]"
            />
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {memories.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-faint">
            还没有记忆。手动添加，或开启自动记忆后由 Mind 在对话后提取。
          </p>
        )}
        {memories.length > 0 && visibleMemories.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-faint">
            没有找到包含「{query.trim()}」的记忆。
          </p>
        )}
        {visibleMemories.map((memory) => (
          <div key={memory.id} className="rounded-lg border border-line px-3.5 py-2.5">
            {editing?.id === memory.id ? (
              <div>
                <Textarea
                  rows={2}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  autoFocus
                />
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    取消
                  </Button>
                  <Button size="sm" variant="primary" onClick={saveEdit} disabled={!editDraft.trim()}>
                    保存
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <p className="flex-1 whitespace-pre-wrap text-[12.5px] leading-5 text-ink">
                  {memory.content}
                </p>
                <span className="mt-0.5 shrink-0 text-[10px] text-faint">
                  {new Date(memory.updatedAt).toLocaleDateString("zh-CN")}
                </span>
                {memory.source === "auto" && (
                  <span className="mt-0.5 shrink-0 rounded border border-line px-1 py-px text-[10px] text-faint">
                    自动
                  </span>
                )}
                <IconButton
                  label="编辑记忆"
                  size="sm"
                  onClick={() => {
                    setEditing(memory);
                    setEditDraft(memory.content);
                  }}
                >
                  <Pencil size={13} />
                </IconButton>
                <IconButton label="删除记忆" size="sm" onClick={() => remove(memory)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AboutPanel() {
  const mobile = isMobilePlatform();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => {});
  }, []);

  return (
    <section>
      <SectionHeader title="关于" description="版本信息与本地数据位置。" />
      <div className="mt-6 rounded-xl border border-line p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-muted">版本</span>
          <span className="text-[13px] text-ink">{info?.version ?? "…"}</span>
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[13px] text-muted">本地数据</div>
          <p className="mt-1 select-all break-all font-mono text-[11.5px] leading-5 text-faint">
            {info?.dataDir ?? "…"}
          </p>
          <div className="mt-2 flex gap-2">
            {!mobile && (
              <Button
                size="sm"
                variant="ghost"
                icon={<FolderOpen size={13} />}
                onClick={() => api.openDataDir().catch(() => {})}
              >
                打开数据目录
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={async () => {
                if (info && (await copyText(info.dataDir))) {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                }
              }}
            >
              复制路径
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-4 text-[12px] leading-5 text-muted">
        {mobile
          ? "Mind 是一款模型无关的 AI 客户端。聊天记录只保存在手机本地；Android 预览版的 API Key 只保存在本次运行的内存中。"
          : "Mind 是一款模型无关的桌面 AI 客户端。聊天记录只保存在本机，API Key 保存在 Windows 凭据管理器中。"}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px]">
        <button
          className="flex items-center gap-1 text-accent hover:underline"
          onClick={() => api.openExternal("https://platform.deepseek.com").catch(() => {})}
        >
          DeepSeek 开放平台
          <ExternalLink size={11} />
        </button>
        <span className="text-faint">·</span>
        <button
          className="flex items-center gap-1 text-accent hover:underline"
          onClick={() =>
            api
              .openExternal(
                "https://github.com/stone2010/Mind/blob/main/docs/USER_AGREEMENT.md",
              )
              .catch(() => {})
          }
        >
          用户协议
          <ExternalLink size={11} />
        </button>
        <span className="text-faint">·</span>
        <button
          className="flex items-center gap-1 text-accent hover:underline"
          onClick={() =>
            api
              .openExternal("https://github.com/stone2010/Mind/blob/main/docs/PRIVACY.md")
              .catch(() => {})
          }
        >
          隐私说明
          <ExternalLink size={11} />
        </button>
        <span className="text-faint">·</span>
        <span className="text-faint">Mind v{info?.version ?? "0.1.0"}</span>
      </div>
    </section>
  );
}

const NAV_ITEMS: { id: SettingsSection; label: string; icon: typeof Info }[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "model", label: "模型连接", icon: Link2 },
  { id: "connectors", label: "连接器", icon: Plug },
  { id: "memory", label: "记忆", icon: Brain },
  { id: "usage", label: "用量与费用", icon: Gauge },
  { id: "data", label: "数据与备份", icon: DatabaseBackup },
  { id: "about", label: "关于", icon: Info },
];

export function SettingsView() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const section: SettingsSection = view.name === "settings" ? view.section : "general";
  const [advancedOpen, setAdvancedOpen] = useState(section === "developer");
  const mobile = useIsMobileLayout();

  useEffect(() => {
    if (section === "developer") setAdvancedOpen(true);
  }, [section]);

  const select = (id: SettingsSection) => setView({ name: "settings", section: id });

  const panels = (
    <>
      {section === "general" && <GeneralPanel />}
      {section === "model" && <ModelPanel />}
      {section === "connectors" && <ConnectorSettings />}
      {section === "memory" && <MemoryPanel />}
      {section === "usage" && <UsageSettings />}
      {section === "data" && <DataSettings />}
      {section === "about" && <AboutPanel />}
      {section === "developer" && <DeveloperSettings />}
    </>
  );

  if (mobile) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-bg">
        <div className="flex h-12 shrink-0 items-center border-b border-line px-2">
          <button
            onClick={() => setView({ name: "chat" })}
            className="flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] text-muted hover:bg-hover hover:text-ink"
          >
            <ArrowLeft size={17} />
            返回
          </button>
          <h1 className="flex-1 text-center text-[13.5px] font-medium text-ink">设置</h1>
          <div className="w-[64px]" />
        </div>

        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => select(item.id)}
              className={clsx(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] transition-colors",
                section === item.id
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              <item.icon size={13.5} strokeWidth={1.8} />
              {item.label}
            </button>
          ))}
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] text-faint hover:bg-hover hover:text-muted"
          >
            <Wrench size={13} />
            高级
            <ChevronDown
              size={11}
              className={clsx("transition-transform", advancedOpen && "rotate-180")}
            />
          </button>
        </div>

        {advancedOpen && (
          <div className="shrink-0 border-b border-line bg-sidebar px-3 py-1.5">
            <button
              onClick={() => select("developer")}
              className={clsx(
                "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12px]",
                section === "developer"
                  ? "bg-active text-ink"
                  : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              开发者选项 · 模型提供商
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[700px] px-4 py-5">{panels}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 bg-bg">
      <div className="flex w-[228px] shrink-0 flex-col border-r border-line bg-sidebar px-3 py-3">
        <button
          onClick={() => setView({ name: "chat" })}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-muted hover:bg-hover hover:text-ink"
        >
          <ArrowLeft size={14} />
          返回对话
        </button>
        <h1 className="mb-2 mt-4 px-2 text-[13px] font-semibold text-ink">设置</h1>
        <nav className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => select(item.id)}
              className={clsx(
                "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] transition-colors",
                section === item.id
                  ? "bg-active text-ink"
                  : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              <item.icon size={15} strokeWidth={1.7} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t border-line pt-2">
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12px] text-faint hover:bg-hover hover:text-muted"
          >
            <Wrench size={13} />
            <span className="flex-1 text-left">高级设置</span>
            <ChevronDown
              size={12}
              className={clsx("transition-transform", advancedOpen && "rotate-180")}
            />
          </button>
          {advancedOpen && (
            <button
              onClick={() => select("developer")}
              className={clsx(
                "mt-0.5 flex h-8 w-full items-center gap-2.5 rounded-lg py-0 pl-7 pr-2.5 text-[12px] transition-colors",
                section === "developer"
                  ? "bg-active text-ink"
                  : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              开发者选项 · 模型提供商
            </button>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[700px] px-8 py-8">{panels}</div>
      </div>
    </div>
  );
}
