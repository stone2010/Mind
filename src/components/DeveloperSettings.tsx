import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Plus,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/bridge";
import { uuid } from "../lib/utils";
import { useAppStore } from "../store/app";
import { confirmDialog } from "../store/confirm";
import { pushToast } from "../store/toast";
import type { ModelConfig, ProviderConfig, TestResult } from "../types";
import { Button, Field, IconButton, Input, Switch } from "./ui";

function emptyModel(): ModelConfig {
  return {
    id: "",
    label: "",
    supportsThinking: false,
    supportsVision: false,
    temperature: null,
    maxTokens: null,
  };
}

function blankProvider(): ProviderConfig {
  return {
    id: `provider-${uuid().slice(0, 8)}`,
    name: "",
    kind: "openai-compatible",
    baseUrl: "https://",
    models: [{ ...emptyModel() }],
    isBuiltin: false,
  };
}

export function DeveloperSettings() {
  const providers = useAppStore((s) => s.providers);
  const settings = useAppStore((s) => s.settings);
  const keyPresent = useAppStore((s) => s.keyPresent);
  const saveProviders = useAppStore((s) => s.saveProviders);
  const refreshProviders = useAppStore((s) => s.refreshProviders);
  const refreshKeyStatus = useAppStore((s) => s.refreshKeyStatus);
  const setModel = useAppStore((s) => s.setModel);

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testModelId, setTestModelId] = useState("");

  const startEdit = (provider: ProviderConfig | null) => {
    const clone: ProviderConfig = provider
      ? JSON.parse(JSON.stringify(provider))
      : blankProvider();
    setDraft(clone);
    setIsNew(!provider);
    setKeyInput("");
    setShowKey(false);
    setFormError(null);
    setTestResult(null);
    setTestModelId(clone.models[0]?.id ?? "");
    setMode("edit");
  };

  const patch = (value: Partial<ProviderConfig>) =>
    setDraft((d) => (d ? { ...d, ...value } : d));

  const patchModel = (index: number, value: Partial<ModelConfig>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            models: d.models.map((m, i) => (i === index ? { ...m, ...value } : m)),
          }
        : d,
    );

  const validate = (p: ProviderConfig): string | null => {
    if (!p.name.trim()) return "请填写提供商名称。";
    if (!/^https?:\/\/.+/.test(p.baseUrl.trim())) return "API Base URL 必须以 http:// 或 https:// 开头。";
    if (p.models.length === 0) return "至少需要配置一个模型。";
    const ids = new Set<string>();
    for (const m of p.models) {
      if (!m.id.trim()) return "模型的 ID 不能为空。";
      if (!m.label.trim()) return "模型的显示名称不能为空。";
      if (ids.has(m.id.trim())) return `模型 ID「${m.id}」重复。`;
      ids.add(m.id.trim());
      if (m.temperature != null && (m.temperature < 0 || m.temperature > 2))
        return "温度需要在 0 到 2 之间。";
      if (m.maxTokens != null && (!Number.isInteger(m.maxTokens) || m.maxTokens < 1))
        return "最大 Tokens 需要是大于 0 的整数。";
    }
    return null;
  };

  const save = async () => {
    if (!draft) return;
    const error = validate(draft);
    if (error) {
      setFormError(error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const normalized: ProviderConfig = {
        ...draft,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
        models: draft.models.map((m) => ({
          ...m,
          id: m.id.trim(),
          label: m.label.trim(),
        })),
      };
      if (keyInput.trim()) {
        await api.credentialSave(normalized.id, keyInput.trim());
      }
      const list = isNew
        ? [...providers, normalized]
        : providers.map((p) => (p.id === normalized.id ? normalized : p));
      await saveProviders(list);
      await refreshKeyStatus();
      setSaving(false);
      setMode("list");
      setDraft(null);
      pushToast({
        kind: "success",
        title: isNew ? "已添加模型提供商" : "已保存模型提供商",
      });
    } catch (err) {
      setSaving(false);
      setFormError(errorMessage(err));
    }
  };

  const test = async () => {
    if (!draft) return;
    const model = draft.models.find((m) => m.id === testModelId) ?? draft.models[0];
    if (!model || !model.id.trim()) {
      setFormError("请先填写模型 ID，再测试连接。");
      return;
    }
    const key = keyInput.trim();
    if (!key && !keyPresent[draft.id]) {
      setFormError("请填写 API Key 后再测试连接。");
      return;
    }
    setTesting(true);
    setFormError(null);
    setTestResult(null);
    try {
      const result = await api.providerTest(
        { ...draft, baseUrl: draft.baseUrl.trim().replace(/\/+$/, "") },
        model.id.trim(),
        key || undefined,
      );
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

  const removeProvider = async (provider: ProviderConfig) => {
    if (providers.length <= 1) {
      pushToast({ kind: "error", title: "至少需要保留一个模型提供商。" });
      return;
    }
    const ok = await confirmDialog({
      title: `删除「${provider.name}」？`,
      body: "该提供商的 API Key 也会从 Windows 凭据管理器中移除，此操作无法撤销。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.providerRemove(provider.id);
      await refreshProviders();
      await refreshKeyStatus();
      const rest = useAppStore.getState().providers;
      if (settings.providerId === provider.id && rest[0]) {
        await setModel(rest[0].id, rest[0].models[0]?.id ?? "");
      }
      pushToast({ kind: "success", title: "已删除模型提供商" });
    } catch (err) {
      pushToast({ kind: "error", title: "删除失败", detail: errorMessage(err) });
    }
  };

  if (mode === "edit" && draft) {
    const keySaved = !!keyPresent[draft.id];
    return (
      <section>
        <button
          onClick={() => setMode("list")}
          className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink"
        >
          <ArrowLeft size={13} />
          返回提供商列表
        </button>
        <h2 className="mt-3 text-[18px] font-semibold tracking-[-0.01em] text-ink">
          {isNew ? "添加模型提供商" : `编辑 ${draft.name || "提供商"}`}
        </h2>
        <p className="mt-1 text-[12px] leading-5 text-muted">
          请求会发送到 <span className="font-mono">{"{Base URL}"}/chat/completions</span>，使用 Bearer
          鉴权。
        </p>

        <div className="mt-5 space-y-4 rounded-xl border border-line p-4">
          <Field label="显示名称">
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="例如 DeepSeek、公司内网模型"
            />
          </Field>

          <Field label="接口类型">
            <select
              value={draft.kind}
              onChange={(e) =>
                patch({ kind: e.target.value as ProviderConfig["kind"] })
              }
              className="h-9 w-full rounded-lg border border-line bg-panel px-2 text-[13px] text-ink focus:border-accent focus:ring-2 focus:ring-accent-soft"
            >
              <option value="deepseek">DeepSeek（官方 API）</option>
              <option value="openai-compatible">OpenAI Compatible / 自定义</option>
            </select>
          </Field>

          <Field
            label="API Base URL"
            hint={
              draft.kind === "deepseek" ? "官方地址：https://api.deepseek.com" : undefined
            }
          >
            <Input
              value={draft.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              className="font-mono text-[12.5px]"
            />
          </Field>

          <Field label="API Key" hint={keySaved ? "已保存，留空表示不修改" : "尚未保存"}>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={keySaved ? "••••••••（留空保持不变）" : "请输入 API Key"}
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
        </div>

        <div className="mt-4 rounded-xl border border-line p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium text-ink">模型</div>
              <p className="mt-0.5 text-[11.5px] text-muted">
                模型 ID 需要与服务商文档中的标识完全一致。
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus size={13} />}
              onClick={() =>
                setDraft((d) => (d ? { ...d, models: [...d.models, emptyModel()] } : d))
              }
            >
              添加模型
            </Button>
          </div>

          <div className="mt-3 space-y-3">
            {draft.models.map((model, index) => (
              <div key={index} className="rounded-lg border border-line bg-sidebar/60 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[150px] flex-1">
                    <label className="mb-1 block text-[11px] text-muted">模型 ID</label>
                    <Input
                      value={model.id}
                      onChange={(e) => patchModel(index, { id: e.target.value })}
                      placeholder="deepseek-flash"
                      spellCheck={false}
                      className="h-8 font-mono text-[12px]"
                    />
                  </div>
                  <div className="min-w-[130px] flex-1">
                    <label className="mb-1 block text-[11px] text-muted">显示名称</label>
                    <Input
                      value={model.label}
                      onChange={(e) => patchModel(index, { label: e.target.value })}
                      placeholder="DeepSeek Flash"
                      className="h-8 text-[12.5px]"
                    />
                  </div>
                  <IconButton
                    label="删除模型"
                    size="sm"
                    className="mb-0.5 text-faint hover:text-danger"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, models: d.models.filter((_, i) => i !== index) } : d,
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div className="flex items-center gap-2 text-[11.5px] text-muted">
                    <Switch
                      checked={model.supportsThinking}
                      onChange={(v) => patchModel(index, { supportsThinking: v })}
                      label="支持深度思考"
                    />
                    <span>支持深度思考</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11.5px] text-muted">
                    <Switch
                      checked={model.supportsVision}
                      onChange={(v) => patchModel(index, { supportsVision: v })}
                      label="支持图片输入"
                    />
                    <span>支持图片输入</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11.5px] text-muted">
                    <Switch
                      checked={model.supportsWebSearch === true}
                      onChange={(v) => patchModel(index, { supportsWebSearch: v })}
                      label="支持联网搜索"
                    />
                    <span>支持联网搜索</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-line pt-2">
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted">
                    温度
                    <Input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={model.temperature ?? ""}
                      onChange={(e) =>
                        patchModel(index, {
                          temperature:
                            e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      placeholder="默认"
                      className="h-7 w-[64px] px-1.5 text-[11.5px]"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted">
                    最大 Tokens
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={model.maxTokens ?? ""}
                      onChange={(e) =>
                        patchModel(index, {
                          maxTokens: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      placeholder="默认"
                      className="h-7 w-[84px] px-1.5 text-[11.5px]"
                    />
                  </label>
                  <span className="ml-auto text-[10.5px] text-faint">
                    留空使用服务商默认值 · 深度思考时温度不生效
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {formError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[12px] leading-5 text-danger">
            <AlertTriangle size={13} className="mt-[3px] shrink-0" />
            <span>{formError}</span>
          </div>
        )}

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
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-panel/70 p-2 font-mono text-[10.5px] leading-4 text-muted">
                    {testResult.error.detail}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {draft.models.length > 1 && (
            <select
              value={testModelId}
              onChange={(e) => setTestModelId(e.target.value)}
              className="h-9 rounded-lg border border-line bg-panel px-2 text-[12px] text-ink"
            >
              {draft.models.map((m, i) => (
                <option key={i} value={m.id}>
                  {m.label || m.id || `模型 ${i + 1}`}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            variant="ghost"
            loading={testing}
            onClick={test}
            className="text-accent"
          >
            测试连接
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setMode("list")}>
            取消
          </Button>
          <Button size="sm" variant="primary" loading={saving} onClick={save}>
            保存
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
            开发者选项
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-muted">
            模型提供商与接口配置。这里的改动只影响高级用法，普通聊天无需修改。
          </p>
        </div>
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => startEdit(null)}
          className="shrink-0"
        >
          添加提供商
        </Button>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-sidebar px-3 py-2 text-[11.5px] leading-5 text-muted">
        <AlertTriangle size={13} className="mt-[3px] shrink-0 text-faint" />
        <span>
          填写错误的 Base URL 或模型 ID 会导致对话失败。DeepSeek 官方地址为
          <span className="font-mono"> https://api.deepseek.com </span>
          ，通常无需修改。
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-ink">默认模型</div>
            <p className="mt-0.5 text-[11.5px] text-muted">
              新对话默认使用的模型，也可以在聊天输入框旁快速切换。
            </p>
          </div>
          <select
            value={`${settings.providerId}::${settings.modelId}`}
            onChange={(e) => {
              const [providerId, modelId] = e.target.value.split("::");
              void setModel(providerId, modelId);
            }}
            className="h-9 max-w-[280px] rounded-lg border border-line bg-panel px-2 text-[12.5px] text-ink focus:border-accent focus:ring-2 focus:ring-accent-soft"
          >
            {providers.map((p) => (
              <optgroup key={p.id} label={p.name}>
                {p.models.map((m) => (
                  <option key={`${p.id}-${m.id}`} value={`${p.id}::${m.id}`}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="flex items-start gap-3 rounded-xl border border-line p-4"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Server size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium text-ink">{provider.name}</span>
                <span className="rounded border border-line px-1 py-px text-[10px] text-faint">
                  {provider.kind === "deepseek" ? "DeepSeek" : "OpenAI Compatible"}
                </span>
                {provider.isBuiltin && (
                  <span className="rounded bg-sidebar px-1 py-px text-[10px] text-faint">
                    内置
                  </span>
                )}
                {keyPresent[provider.id] && (
                  <span className="flex items-center gap-1 text-[10.5px] text-success">
                    <span className="h-1 w-1 rounded-full bg-success" />
                    已保存密钥
                  </span>
                )}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-faint">
                {provider.baseUrl}
              </div>
              <div className="mt-1 truncate text-[11.5px] text-muted">
                {provider.models.map((m) => m.label).join(" · ")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => startEdit(provider)}>
                编辑
              </Button>
              <IconButton
                label="删除提供商"
                size="sm"
                className="hover:text-danger"
                onClick={() => removeProvider(provider)}
              >
                <Trash2 size={13.5} />
              </IconButton>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
