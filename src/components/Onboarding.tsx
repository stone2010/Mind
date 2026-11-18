import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  Clock,
  Eye,
  EyeOff,
  Gauge,
  Globe2,
  Lock,
  Plug,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/bridge";
import { DEFAULT_DEEPSEEK_PROVIDER } from "../lib/defaults";
import { isMobilePlatform } from "../lib/platform";
import {
  CONNECTOR_PRESETS,
  runtimeAvailable,
  runtimeLabel,
} from "../lib/connectorPresets";
import { useAppStore } from "../store/app";
import { pushToast } from "../store/toast";
import type { ProviderError, RuntimeInfo } from "../types";
import { Button, Input, Logo, Switch } from "./ui";

type Step = "welcome" | "key" | "preferences" | "plugins";

const CONTEXT_OPTIONS = [
  {
    value: 4000,
    title: "省 token",
    hint: "最近约 4k tokens，适合日常短对话，费用最低。",
  },
  {
    value: 8000,
    title: "平衡",
    hint: "最近约 8k tokens，兼顾上下文和费用。",
  },
  {
    value: 100000,
    title: "长上下文",
    hint: "最近约 100k tokens，适合长文和长期项目；超出后自动压缩。",
    recommended: true,
  },
  {
    value: 0,
    title: "完整历史",
    hint: "不裁剪历史，输入 token 会持续增长，只建议特殊场景使用。",
  },
];

function StepDots({ step }: { step: Step }) {
  const index = step === "key" ? 0 : step === "preferences" ? 1 : 2;
  return (
    <div className="flex items-center gap-2">
      {["连接模型", "使用偏好", "插件"].map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={clsx(
              "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium",
              i < index
                ? "bg-accent text-white"
                : i === index
                  ? "bg-accent-soft text-accent"
                  : "bg-sidebar text-faint",
            )}
          >
            {i < index ? <Check size={11} /> : i + 1}
          </span>
          <span
            className={clsx(
              "text-[11px]",
              i === index ? "text-ink" : "text-faint",
            )}
          >
            {label}
          </span>
          {i < 2 && <span className="h-px w-4 bg-line" />}
        </div>
      ))}
    </div>
  );
}

function PreferenceRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line p-3.5">
      <div>
        <div className="text-[12.5px] font-medium text-ink">{title}</div>
        <p className="mt-0.5 text-[11.5px] leading-5 text-muted">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function Onboarding() {
  const mobile = isMobilePlatform();
  const providers = useAppStore((s) => s.providers);
  const reason = useAppStore((s) => s.onboardingReason);
  const keyPresent = useAppStore((s) => s.keyPresent);
  const finishOnboarding = useAppStore((s) => s.finishOnboarding);
  const saveProviders = useAppStore((s) => s.saveProviders);
  const refreshProviders = useAppStore((s) => s.refreshProviders);
  const refreshKeyStatus = useAppStore((s) => s.refreshKeyStatus);

  const provider = useMemo(
    () =>
      providers.find((p) => p.id === "deepseek" && p.kind === "deepseek") ??
      DEFAULT_DEEPSEEK_PROVIDER,
    [providers],
  );
  const modelId = provider.models[0]?.id ?? "deepseek-flash";

  const [step, setStep] = useState<Step>(reason === "missing-key" ? "key" : "welcome");
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ProviderError | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [connected, setConnected] = useState(
    reason !== "missing-key" && !!keyPresent[provider.id],
  );
  const [contextTokens, setContextTokens] = useState(100000);
  const [autoCompress, setAutoCompress] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [autoMemory, setAutoMemory] = useState(true);
  const [usageEnabled, setUsageEnabled] = useState(true);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  const [finishing, setFinishing] = useState(false);

  const pluginPresets = CONNECTOR_PRESETS.filter((p) => p.id !== "filesystem");

  useEffect(() => {
    if (mobile || step !== "plugins") return;
    let alive = true;
    setRuntimeLoading(true);
    api
      .runtimeCheck()
      .then((info) => {
        if (alive) setRuntime(info);
      })
      .catch(() => {
        if (alive) setRuntime(null);
      })
      .finally(() => {
        if (alive) setRuntimeLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [step]);

  const connect = async () => {
    setError(null);
    setDetailOpen(false);
    const trimmed = key.trim();
    if (!trimmed) {
      setError({ code: "empty", message: "请输入你的 DeepSeek API Key。" });
      return;
    }
    if (trimmed.length < 8 || /\s/.test(trimmed)) {
      setError({
        code: "format",
        message: "API Key 格式看起来不正确，请检查是否完整复制。",
      });
      return;
    }
    setBusy(true);
    try {
      const result = await api.onboardingConnect(provider, trimmed, modelId);
      if (!result.ok) {
        setError(
          result.error ?? { code: "unknown", message: "连接失败，请稍后再试。" },
        );
        return;
      }
      await refreshProviders();
      await refreshKeyStatus();
      setConnected(true);
      setKey("");
      setStep("preferences");
    } catch (err) {
      setError({
        code: "unknown",
        message: "无法完成连接，请稍后再试。",
        detail: errorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const startDemo = async () => {
    if (!providers.some((p) => p.id === provider.id)) {
      try {
        await saveProviders([...providers, provider]);
      } catch (err) {
        pushToast({
          kind: "error",
          title: "无法启动演示模式",
          detail: errorMessage(err),
        });
        return;
      }
    }
    await finishOnboarding({
      providerId: provider.id,
      modelId,
      demoMode: true,
      onboarded: true,
      contextTokens: 100000,
      autoCompress: true,
      usageEnabled: true,
    });
  };

  const finish = async () => {
    setFinishing(true);
    const failures: string[] = [];
    for (const id of selectedPlugins) {
      const preset = pluginPresets.find((p) => p.id === id);
      if (!preset || !runtimeAvailable(preset, runtime)) continue;
      try {
        const info = await api.connectorSave({
          id: "",
          name: preset.name,
          command: preset.command,
          args: preset.args,
          enabled: true,
        });
        if (!info.connected) failures.push(preset.name);
      } catch {
        failures.push(preset.name);
      }
    }
    await finishOnboarding({
      providerId: provider.id,
      modelId,
      demoMode: false,
      onboarded: true,
      contextTokens,
      autoCompress,
      webSearch,
      autoMemory,
      usageEnabled,
    });
    if (failures.length) {
      pushToast({
        kind: "error",
        title: "部分插件未能连接",
        detail: `${failures.join("、")}。可稍后在设置 → 连接器中查看错误并重试。`,
      });
    }
    setFinishing(false);
  };

  const renderBack = (target: Step) => (
    <button
      onClick={() => setStep(target)}
      className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink"
    >
      <ArrowLeft size={14} />
      返回
    </button>
  );

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex w-full max-w-[560px] flex-col justify-center px-6 py-10">
        {step === "welcome" && (
          <>
            <Logo height={58} />
            <h1 className="mt-7 text-[26px] font-semibold tracking-[-0.015em] text-ink">
              欢迎使用 Mind
            </h1>
            <p className="mt-2 text-[14px] leading-6 text-muted">
              一个数据留在本机、按量付费的 AI 工作台。用几分钟完成配置，之后打开就能聊天。
            </p>

            {reason === "missing-key" && (
              <div className="mt-5 rounded-lg border border-line bg-sidebar px-3 py-2 text-[12.5px] text-muted">
                之前的连接已失效或 API Key 已被移除，请重新连接 DeepSeek。
              </div>
            )}

            <div className="mt-7 space-y-3">
              {[
                {
                  icon: ShieldCheck,
                  title: "数据留在本机",
                  text: mobile
                    ? "聊天记录、记忆和用量保存在手机本地；API Key 只在本次运行的内存中，重启后需重新输入。"
                    : "聊天记录、记忆和用量保存在本地 SQLite；API Key 存入 Windows 凭据管理器。",
                },
                {
                  icon: Wallet,
                  title: "按量付费，费用可控",
                  text: "直接使用你自己的 DeepSeek Key，上下文长度可调，不经过订阅或 Mind 的服务器。",
                },
                {
                  icon: Plug,
                  title: "可以接入工具",
                  text: mobile
                    ? "可以连接 GitHub 读取仓库与 Issue；每次工具调用都要你确认。"
                    : "通过本地 MCP 插件读取文件、抓取网页；每次工具调用都要你确认。",
                },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3 rounded-xl border border-line p-3.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <item.icon size={15} />
                  </div>
                  <div>
                    <div className="text-[12.5px] font-medium text-ink">{item.title}</div>
                    <p className="mt-0.5 text-[11.5px] leading-5 text-muted">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="primary"
              size="lg"
              className="mt-6 w-full"
              onClick={() => setStep("key")}
            >
              开始配置
              <ArrowRight size={15} />
            </Button>
            <button
              onClick={startDemo}
              className="mt-3 text-[12.5px] text-faint transition-colors hover:text-muted"
            >
              先体验演示模式（不连接网络）
            </button>

            <div className="mt-8 flex items-start gap-2 border-t border-line pt-4 text-[11.5px] leading-5 text-faint">
              <Lock size={12} className="mt-[3px] shrink-0" />
              <p>
                Mind 不会上传你的 API Key。应用只直接连接你选择的模型服务商。
              </p>
            </div>
          </>
        )}

        {step === "key" && (
          <>
            <div className="flex items-center justify-between">
              <StepDots step={step} />
              {renderBack("welcome")}
            </div>
            <h1 className="mt-7 text-[24px] font-semibold tracking-[-0.01em] text-ink">
              连接 DeepSeek
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-muted">
              Mind 默认使用 DeepSeek 官方 API。你只需要提供 API Key，不需要填写模型地址或其他参数。
            </p>

            {reason === "missing-key" && (
              <div className="mt-4 rounded-lg border border-line bg-sidebar px-3 py-2 text-[12px] text-muted">
                之前的连接已失效，请重新填写 API Key。
              </div>
            )}

            <ol className="mt-5 space-y-2.5">
              {[
                "打开 DeepSeek 开放平台并登录（没有账号可用手机号注册）。",
                "在「API Keys」页面创建一个 Key，名称可以随便填。",
                "复制以 sk- 开头的完整 Key，粘贴到下方。",
              ].map((text, index) => (
                <li key={text} className="flex items-start gap-2.5 text-[12.5px] leading-5 text-muted">
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-medium text-accent">
                    {index + 1}
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>

            <button
              onClick={() =>
                api.openExternal("https://platform.deepseek.com/api_keys").catch(() => {})
              }
              className="mt-3 flex items-center gap-1 text-[12.5px] text-accent hover:underline"
            >
              打开 DeepSeek API Keys 页面
              <ArrowRight size={12} />
            </button>

            <div className="mt-5">
              <label
                htmlFor="onboarding-key"
                className="mb-1.5 block text-[12.5px] font-medium text-ink"
              >
                API Key
              </label>
              <div className="relative">
                <Input
                  id="onboarding-key"
                  type={show ? "text" : "password"}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) void connect();
                  }}
                  placeholder="粘贴 sk- 开头的 API Key"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  className="h-11 pr-10 font-mono text-[13px]"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-1 top-1 flex h-9 w-8 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
                  aria-label={show ? "隐藏密钥" : "显示密钥"}
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              {error && (
                <div className="mt-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2">
                  <p className="text-[12.5px] leading-5 text-danger">{error.message}</p>
                  {error.detail && (
                    <button
                      className="mt-0.5 text-[11.5px] text-danger/75 hover:text-danger"
                      onClick={() => setDetailOpen((v) => !v)}
                    >
                      {detailOpen ? "收起详细错误" : "查看详细错误"}
                    </button>
                  )}
                  {detailOpen && error.detail && (
                    <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-panel/60 p-2 font-mono text-[10.5px] leading-4 text-muted">
                      {error.detail}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {connected && (
              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-success">
                <Check size={12} /> 已检测到已保存的 DeepSeek Key，可直接继续；也可以填写新 Key 替换。
              </p>
            )}
            <Button
              variant="primary"
              size="lg"
              loading={busy}
              onClick={() => {
                if (connected && !key.trim()) setStep("preferences");
                else void connect();
              }}
              className="mt-4 w-full"
            >
              {busy ? "正在连接 DeepSeek…" : connected ? "继续" : "连接并继续"}
              {!busy && <ArrowRight size={15} />}
            </Button>
            <button
              onClick={startDemo}
              disabled={busy}
              className="mt-3 text-[12.5px] text-faint transition-colors hover:text-muted"
            >
              暂时没有 Key？先体验演示模式
            </button>

            <div className="mt-7 flex items-start gap-2 border-t border-line pt-4 text-[11.5px] leading-5 text-faint">
              <Lock size={12} className="mt-[3px] shrink-0" />
              <p>
                {mobile
                  ? "API Key 只保存在本次运行的内存中，不写入数据库或配置文件，也不会发送给 Mind；重启应用后需要重新输入。"
                  : "API Key 只保存在本机 Windows 凭据管理器，不写入聊天数据库或配置文件，也不会发送给 Mind。"}
              </p>
            </div>
          </>
        )}

        {step === "preferences" && (
          <>
            <div className="flex items-center justify-between">
              <StepDots step={step} />
              {renderBack("key")}
            </div>
            <h1 className="mt-7 text-[24px] font-semibold tracking-[-0.01em] text-ink">
              你打算怎么用？
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-muted">
              这些设置决定每次请求携带多少上下文、会调用哪些额外功能，之后都能在设置中修改。
            </p>

            <div className="mt-6">
              <div className="text-[12.5px] font-medium text-ink">对话上下文长度</div>
              <p className="mt-0.5 text-[11.5px] text-muted">
                越短越省 token；超出后会从较早的消息开始裁剪。
              </p>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                {CONTEXT_OPTIONS.map((option) => {
                  const active = contextTokens === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setContextTokens(option.value)}
                      className={clsx(
                        "rounded-xl border p-3 text-left transition-colors",
                        active
                          ? "border-accent/40 bg-accent-soft"
                          : "border-line hover:bg-hover",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={clsx("text-[12.5px] font-medium", active ? "text-accent" : "text-ink")}>
                          {option.title}
                        </span>
                        {option.recommended && (
                          <span className="rounded border border-accent/30 px-1 py-px text-[9px] text-accent">
                            推荐
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-muted">{option.hint}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <PreferenceRow
                title="自动压缩较早对话"
                description="超出上下文上限时，用一次轻量调用生成摘要，避免重复发送旧消息；压缩本身会产生少量 token。"
                checked={autoCompress}
                onChange={setAutoCompress}
              />
              <PreferenceRow
                title="联网搜索"
                description="让模型在需要时搜索网页。由 DeepSeek 服务端执行，可能按次产生额外费用；默认关闭。"
                checked={webSearch}
                onChange={setWebSearch}
              />
              <PreferenceRow
                title="自动记忆（跨对话）"
                description="每次回复后额外调用一次模型提取值得长期记住的信息，下次开新对话也会记得你。默认开启；产生少量 token，可在记忆页关闭或手动管理。"
                checked={autoMemory}
                onChange={setAutoMemory}
              />
              <PreferenceRow
                title="记录用量与费用"
                description="在本机记录服务商返回的真实 token 用量，并按峰谷单价估算费用；可随时关闭或清除。"
                checked={usageEnabled}
                onChange={setUsageEnabled}
              />
            </div>

            <Button
              variant="primary"
              size="lg"
              loading={finishing}
              onClick={() => {
                if (mobile) void finish();
                else setStep("plugins");
              }}
              className="mt-5 w-full"
            >
              {mobile ? "完成配置，开始使用" : "继续选择插件"}
              {!finishing && <ArrowRight size={15} />}
            </Button>
          </>
        )}

        {step === "plugins" && (
          <>
            <div className="flex items-center justify-between">
              <StepDots step={step} />
              {renderBack("preferences")}
            </div>
            <h1 className="mt-7 text-[24px] font-semibold tracking-[-0.01em] text-ink">
              要接入哪些工具？
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-muted">
              插件通过本地 MCP 进程运行。选中后 Mind 会启动服务并读取工具；模型每次调用仍会单独请求你的授权。
            </p>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-sidebar px-3 py-2 text-[11.5px] text-muted">
              <Gauge size={13} className="shrink-0 text-accent" />
              {runtimeLoading ? "正在检测 Node.js / uv…" : runtimeLabel(runtime)}
            </div>

            <div className="mt-4 space-y-2">
              {pluginPresets.map((preset) => {
                const ready = runtimeAvailable(preset, runtime);
                const selected = selectedPlugins.includes(preset.id);
                const Icon =
                  preset.id === "fetch"
                    ? Globe2
                    : preset.id === "time"
                      ? Clock
                      : preset.id === "memory"
                        ? Brain
                        : Plug;
                return (
                  <button
                    key={preset.id}
                    disabled={!ready}
                    onClick={() =>
                      setSelectedPlugins((current) =>
                        current.includes(preset.id)
                          ? current.filter((id) => id !== preset.id)
                          : [...current, preset.id],
                      )
                    }
                    className={clsx(
                      "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                      selected
                        ? "border-accent/40 bg-accent-soft"
                        : "border-line hover:bg-hover",
                      !ready && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel text-accent">
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-medium text-ink">{preset.name}</span>
                        {preset.recommended && (
                          <span className="rounded border border-accent/30 px-1 py-px text-[9px] text-accent">
                            推荐
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-4 text-muted">{preset.description}</p>
                      <p className={clsx("mt-1 text-[10.5px]", ready ? "text-success" : "text-faint")}>
                        {preset.requires === "node" ? "需要 Node.js" : "需要 uv"}
                        {ready ? " · 可用" : " · 未检测到，可稍后安装"}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        selected
                          ? "border-accent bg-accent text-white"
                          : "border-line-strong",
                      )}
                    >
                      {selected && <Check size={11} />}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-[11px] leading-5 text-faint">
              文件系统插件需要指定文件夹，建议完成引导后在「设置 → 连接器」中添加。
            </p>
            <div className="mt-3 rounded-xl border border-line bg-sidebar p-3.5 text-[11.5px] leading-5 text-muted">
              <div className="flex items-center gap-1.5 font-medium text-ink">
                <ShieldCheck size={13} className="text-accent" />
                GitHub、邮箱可以接吗？
              </div>
              <p className="mt-1">
                GitHub 已支持：完成引导后，在「设置 → 连接器 → GitHub」填入 Personal Access Token，即可读取仓库、Issue、PR 和文件。
                QQ 邮箱需要 IMAP 授权码，暂未内置；现在也可以先接入无需登录的本地插件。
              </p>
            </div>

            <Button
              variant="primary"
              size="lg"
              loading={finishing}
              onClick={finish}
              className="mt-5 w-full"
            >
              {finishing
                ? "正在完成配置…"
                : selectedPlugins.length
                  ? `完成并添加 ${selectedPlugins.length} 个插件`
                  : "完成配置，开始使用"}
              {!finishing && <ArrowRight size={15} />}
            </Button>
            <p className="mt-2 text-center text-[11px] text-faint">
              插件连接失败不会影响进入聊天，可稍后在设置中重试。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
