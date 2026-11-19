import {
  AlertCircle,
  Brain,
  Check,
  Clock,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Github,
  Globe2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/bridge";
import { isMobilePlatform } from "../lib/platform";
import {
  CONNECTOR_PRESETS,
  runtimeAvailable,
  runtimeLabel,
  type ConnectorPreset,
} from "../lib/connectorPresets";
import { useAppStore } from "../store/app";
import { confirmDialog } from "../store/confirm";
import { pushToast } from "../store/toast";
import type {
  ConnectorConfig,
  ConnectorInfo,
  ConnectorToolInfo,
  RuntimeInfo,
} from "../types";
import { Button, Field, IconButton, Input, Modal, Switch, Textarea } from "./ui";

interface FormState {
  id: string;
  name: string;
  command: string;
  args: string;
}

const EMPTY_FORM: FormState = { id: "", name: "", command: "", args: "" };

function formConfig(form: FormState): ConnectorConfig {
  return {
    id: form.id,
    name: form.name.trim(),
    command: form.command.trim(),
    args: form.args
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    enabled: true,
    trusted: false,
  };
}

function isSensitiveKey(raw: string): boolean {
  const key = raw.replace(/^-+/, "").replace(/:$/, "").toLowerCase();
  return [
    "token",
    "api_key",
    "apikey",
    "api-key",
    "key",
    "secret",
    "password",
    "passwd",
    "authorization",
    "auth",
    "bearer",
  ].some(
    (part) =>
      key === part ||
      key.endsWith(`_${part}`) ||
      key.endsWith(`-${part}`),
  );
}

function commandPreview(config: Pick<ConnectorConfig, "command" | "args">): string {
  const parts: string[] = [];
  let maskNext = false;
  for (const arg of [config.command, ...config.args]) {
    if (maskNext) {
      parts.push("***");
      maskNext = false;
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals > 0) {
      const key = arg.slice(0, equals);
      if (isSensitiveKey(key)) {
        parts.push(`${key}=***`);
        continue;
      }
    }
    if (isSensitiveKey(arg)) {
      parts.push(arg);
      maskNext = true;
      continue;
    }
    if (/^(sk-|ghp_|github_pat_|glpat-|xox[baprs]-)/i.test(arg)) {
      parts.push("***");
      continue;
    }
    parts.push(arg);
  }
  return parts.join(" ");
}

function isTrusted(info: ConnectorInfo): boolean {
  return info.config.trusted !== false;
}

async function confirmConnectorStart(config: ConnectorConfig): Promise<boolean> {
  return confirmDialog({
    title: "确认启动这个本地连接器？",
    body: `Mind 将以你的 Windows 用户权限启动以下进程：\n\n${commandPreview(config)}\n\n请确认命令和参数来自可信来源。启动确认和逐次工具审批都不是进程沙箱：该进程仍可能访问你的文件、网络和凭据。`,
    confirmLabel: "信任并启动",
    danger: false,
  });
}

export function ConnectorSettings() {
  const settings = useAppStore((s) => s.settings);
  const connectors = useAppStore((s) => s.connectors);
  const github = useAppStore((s) => s.github);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const refreshConnectors = useAppStore((s) => s.refreshConnectors);
  const refreshGithub = useAppStore((s) => s.refreshGithub);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTools, setTestTools] = useState<ConnectorToolInfo[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState<string | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [githubShowToken, setGithubShowToken] = useState(false);
  const [githubBaseUrl, setGithubBaseUrl] = useState("https://api.github.com");
  const [githubAdvanced, setGithubAdvanced] = useState(false);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubTesting, setGithubTesting] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubDetail, setGithubDetail] = useState<string | null>(null);
  const mobile = isMobilePlatform();

  const checkRuntime = async () => {
    setRuntimeBusy(true);
    try {
      setRuntime(await api.runtimeCheck());
    } catch {
      setRuntime(null);
    } finally {
      setRuntimeBusy(false);
    }
  };

  useEffect(() => {
    if (!mobile) void checkRuntime();
  }, [mobile]);

  const saveTrusted = async (config: ConnectorConfig): Promise<ConnectorInfo> => {
    const saved = await api.connectorSave({ ...config, trusted: false });
    if (!saved.config.trusted) {
      return api.connectorSetTrusted(saved.config.id, true);
    }
    return saved;
  };

  const addPreset = async (preset: ConnectorPreset) => {
    if (connectors.some((c) => c.config.name === preset.name)) return;
    if (!runtimeAvailable(preset, runtime)) {
      pushToast({
        kind: "error",
        title: preset.requires === "node" ? "需要先安装 Node.js" : "需要先安装 uv",
        detail:
          preset.requires === "node"
            ? "安装 Node.js 后重新打开应用并点击「检测环境」。"
            : "安装 uv（包含 uvx）后重新打开应用并点击「检测环境」。",
      });
      return;
    }
    if (preset.id === "filesystem") {
      setForm({
        id: "",
        name: preset.name,
        command: preset.command,
        args: preset.args.join("\n"),
      });
      setFormError(null);
      setTestTools(null);
      setTestError(null);
      setFormOpen(true);
      return;
    }
    const presetConfig: ConnectorConfig = {
      id: "",
      name: preset.name,
      command: preset.command,
      args: preset.args,
      enabled: true,
      trusted: false,
    };
    if (!(await confirmConnectorStart(presetConfig))) return;
    setPresetBusy(preset.id);
    try {
      const info = await saveTrusted(presetConfig);
      if (!info.connected) {
        pushToast({
          kind: "error",
          title: `「${preset.name}」添加后连接失败`,
          detail: info.error ?? "请检查运行环境。",
        });
      } else {
        pushToast({
          kind: "success",
          title: `已添加「${preset.name}」`,
          detail: `发现 ${info.tools.length} 个工具`,
        });
      }
      await refreshConnectors();
    } catch (err) {
      pushToast({ kind: "error", title: "添加失败", detail: errorMessage(err) });
    } finally {
      setPresetBusy(null);
    }
  };

  const PRESET_ICONS: Record<string, typeof Plug> = {
    fetch: Globe2,
    time: Clock,
    memory: Brain,
    filesystem: FolderOpen,
  };

  const openGithub = () => {
    setGithubToken("");
    setGithubShowToken(false);
    setGithubBaseUrl(github?.baseUrl || "https://api.github.com");
    setGithubAdvanced(
      !!github?.baseUrl && github.baseUrl !== "https://api.github.com",
    );
    setGithubError(null);
    setGithubDetail(null);
    setGithubOpen(true);
  };

  const connectGithub = async () => {
    const token = githubToken.trim();
    if (!token) {
      setGithubError("请输入 GitHub Personal Access Token。");
      return;
    }
    setGithubBusy(true);
    setGithubError(null);
    setGithubDetail(null);
    try {
      const info = await api.githubConnect(
        token,
        githubBaseUrl.trim() || "https://api.github.com",
      );
      await refreshGithub();
      setGithubOpen(false);
      pushToast({
        kind: "success",
        title: "GitHub 已连接",
        detail: info.login ? `账号：@${info.login}` : "Token 已保存到 Windows 凭据管理器。",
      });
    } catch (err) {
      setGithubError("GitHub 连接失败。");
      setGithubDetail(errorMessage(err));
    } finally {
      setGithubBusy(false);
    }
  };

  const testGithub = async () => {
    setGithubTesting(true);
    try {
      const info = await api.githubTest();
      await refreshGithub();
      pushToast({
        kind: "success",
        title: "GitHub 连接正常",
        detail: info.login ? `当前账号：@${info.login}` : undefined,
      });
    } catch (err) {
      pushToast({
        kind: "error",
        title: "GitHub 连接失败",
        detail: errorMessage(err),
      });
    } finally {
      setGithubTesting(false);
    }
  };

  const disconnectGithub = async () => {
    const ok = await confirmDialog({
      title: "断开 GitHub 连接？",
      body: "Token 会从 Windows 凭据管理器中删除，GitHub 工具将不再出现在对话中。聊天记录不受影响。",
      confirmLabel: "断开",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.githubDisconnect();
      await refreshGithub();
      pushToast({ kind: "success", title: "已断开 GitHub" });
    } catch (err) {
      pushToast({ kind: "error", title: "断开失败", detail: errorMessage(err) });
    }
  };

  const toggleGithub = async (enabled: boolean) => {
    if (enabled && !github?.connected) {
      openGithub();
      return;
    }
    try {
      await api.githubSetEnabled(enabled);
      await refreshGithub();
    } catch (err) {
      pushToast({ kind: "error", title: "操作失败", detail: errorMessage(err) });
    }
  };

  useEffect(() => {
    if (!connectors.some((c) => c.connecting)) return;
    const timer = window.setInterval(() => void refreshConnectors(), 1500);
    return () => window.clearInterval(timer);
  }, [connectors, refreshConnectors]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setTestTools(null);
    setTestError(null);
    setFormError(null);
  };

  const openNew = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setTestTools(null);
    setTestError(null);
    setFormOpen(true);
  };

  const openEdit = (info: ConnectorInfo) => {
    setForm({
      id: info.config.id,
      name: info.config.name,
      command: info.config.command,
      args: info.config.args.join("\n"),
    });
    setFormError(null);
    setTestTools(null);
    setTestError(null);
    setFormOpen(true);
  };

  const testDraft = async () => {
    const config = formConfig(form);
    if (!config.name || !config.command) {
      setFormError("请先填写名称和启动命令。");
      return;
    }
    if (!(await confirmConnectorStart(config))) return;
    setTesting(true);
    setTestError(null);
    setTestTools(null);
    try {
      const tools = await api.connectorTest(config);
      setTestTools(tools);
    } catch (err) {
      setTestError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const config = formConfig(form);
    if (!config.name) {
      setFormError("请填写连接器名称。");
      return;
    }
    if (!config.command) {
      setFormError("请填写启动命令。");
      return;
    }
    if (!(await confirmConnectorStart(config))) return;
    setSaving(true);
    setFormError(null);
    try {
      const info = await saveTrusted(config);
      if (!info.connected) {
        pushToast({
          kind: "error",
          title: "已保存，但连接失败",
          detail: info.error ?? "请检查命令和参数是否正确。",
        });
      } else {
        pushToast({
          kind: "success",
          title: `已连接「${info.config.name}」`,
          detail: `发现 ${info.tools.length} 个工具`,
        });
      }
      await refreshConnectors();
      setFormOpen(false);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (info: ConnectorInfo, enabled: boolean) => {
    if (enabled && !isTrusted(info) && !(await confirmConnectorStart(info.config))) {
      return;
    }
    setBusyId(info.config.id);
    try {
      if (enabled && !isTrusted(info)) {
        await api.connectorSetTrusted(info.config.id, true);
      }
      await api.connectorSetEnabled(info.config.id, enabled);
      await refreshConnectors();
    } catch (err) {
      pushToast({ kind: "error", title: "操作失败", detail: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const connect = async (info: ConnectorInfo) => {
    if (!isTrusted(info) && !(await confirmConnectorStart(info.config))) return;
    setBusyId(info.config.id);
    try {
      if (!isTrusted(info)) {
        await api.connectorSetTrusted(info.config.id, true);
      }
      const result = await api.connectorSetEnabled(info.config.id, true);
      if (!result.connected) {
        pushToast({
          kind: "error",
          title: "连接失败",
          detail: result.error ?? "请检查命令和参数是否正确。",
        });
      }
      await refreshConnectors();
    } catch (err) {
      pushToast({ kind: "error", title: "连接失败", detail: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const revokeTrust = async (info: ConnectorInfo) => {
    const ok = await confirmDialog({
      title: `撤销「${info.config.name}」的启动信任？`,
      body: "连接器进程会立即停止；下次启动或连接前需要重新确认启动命令。已保存的聊天记录和配置不受影响。",
      confirmLabel: "撤销信任",
      danger: true,
    });
    if (!ok) return;
    setBusyId(info.config.id);
    try {
      await api.connectorSetTrusted(info.config.id, false);
      await refreshConnectors();
    } catch (err) {
      pushToast({ kind: "error", title: "操作失败", detail: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const testExisting = async (info: ConnectorInfo) => {
    if (!isTrusted(info) && !(await confirmConnectorStart(info.config))) return;
    setBusyId(info.config.id);
    try {
      const tools = await api.connectorTest(info.config);
      pushToast({
        kind: "success",
        title: `「${info.config.name}」可用`,
        detail: `发现 ${tools.length} 个工具：${tools.map((t) => t.name).join("、") || "无"}`,
      });
    } catch (err) {
      pushToast({ kind: "error", title: "测试失败", detail: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (info: ConnectorInfo) => {
    const ok = await confirmDialog({
      title: `删除连接器「${info.config.name}」？`,
      body: "只会移除 Mind 中的配置，不会卸载或删除这个软件本身。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.connectorDelete(info.config.id);
      await refreshConnectors();
    } catch (err) {
      pushToast({ kind: "error", title: "删除失败", detail: errorMessage(err) });
    }
  };

  return (
    <section>
      <div>
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">连接器</h2>
        <p className="mt-1 text-[12.5px] leading-5 text-muted">
          {mobile
            ? "在手机上通过 GitHub 账号服务读取仓库、Issue、PR 和文件。模型只能在你逐次确认后调用工具。"
            : "通过本地 MCP 插件和 GitHub 账号服务把外部数据接入对话。模型只能在你逐次确认后调用工具。"}
        </p>
      </div>

      {mobile && (
        <div className="mt-4 rounded-xl border border-line bg-sidebar px-3.5 py-3 text-[11.5px] leading-5 text-muted">
          Android 预览版不支持启动本地 MCP 插件进程；GitHub 连接仍可使用。GitHub Token
          只保存在本次运行的内存中，重启应用后需要重新填写。
        </div>
      )}

      <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-line p-4">
        <div>
          <div className="text-[13px] font-medium text-ink">允许模型在对话中使用连接器</div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">
            {mobile
              ? "关闭后，GitHub 工具不会暴露；模型看不到任何工具。每次调用仍会单独请求授权。"
              : "关闭后，本地插件不会被启动，GitHub 工具也不会暴露；模型看不到任何工具。每次调用仍会单独请求授权。"}
          </p>
        </div>
        <Switch
          checked={settings.connectors}
          label="允许模型在对话中使用连接器"
          onChange={(value) => updateSettings({ connectors: value })}
        />
      </div>

      <div className="mt-3 rounded-xl border border-line p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#24292f] text-white">
            <Github size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-ink">GitHub</span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <span
                  className={clsx(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    github?.connected
                      ? github.enabled
                        ? "bg-success"
                        : "bg-[#e0a53a]"
                      : "bg-faint",
                  )}
                />
                {github?.connected
                  ? github.enabled
                    ? `已连接${github.login ? ` @${github.login}` : ""}`
                    : "已停用"
                  : "未连接"}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted">
              {mobile
                ? "读取仓库、Issue、Pull Request 和仓库文件。Token 只保存在本次运行的内存中；模型每次调用工具前仍会请求你的确认。"
                : "读取仓库、Issue、Pull Request 和仓库文件。Token 只保存在 Windows 凭据管理器；模型每次调用工具前仍会请求你的确认。"}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!github?.connected ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Github size={13} />}
                  onClick={openGithub}
                >
                  连接 GitHub
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={openGithub}>
                    更换 Token
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RefreshCw size={13} />}
                    loading={githubTesting}
                    onClick={() => void testGithub()}
                  >
                    测试连接
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    onClick={() => void disconnectGithub()}
                  >
                    断开
                  </Button>
                  <Switch
                    checked={github.enabled}
                    label="启用 GitHub 工具"
                    onChange={(value) => void toggleGithub(value)}
                  />
                </>
              )}
            </div>
            {github?.connected && github.enabled && !settings.connectors && (
              <p className="mt-2 text-[11px] text-[#b07a1c] dark:text-[#e0b35a]">
                上方总开关已关闭，GitHub 工具不会出现在对话中。
              </p>
            )}
            {github?.connected && github.baseUrl !== "https://api.github.com" && (
              <p className="mt-2 break-all font-mono text-[10.5px] text-faint">
                API: {github.baseUrl}
              </p>
            )}
          </div>
        </div>
      </div>

      {!mobile && (
        <>
      <div className="mt-6 rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-ink">推荐插件</div>
            <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
              一键添加本地 MCP 插件。添加后会真实启动进程并检测工具；每次调用仍需你批准。
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={13} />}
            loading={runtimeBusy}
            onClick={() => void checkRuntime()}
          >
            检测环境
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-faint">{runtimeLabel(runtime)}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {CONNECTOR_PRESETS.map((preset) => {
            const ready = runtimeAvailable(preset, runtime);
            const added = connectors.some((c) => c.config.name === preset.name);
            const Icon = PRESET_ICONS[preset.id] ?? Plug;
            return (
              <div key={preset.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-medium text-ink">{preset.name}</span>
                      {preset.recommended && (
                        <span className="rounded border border-accent/25 px-1 py-px text-[9.5px] text-accent">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-4 text-faint">
                      {preset.description}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span
                        className={clsx(
                          "text-[10.5px]",
                          ready ? "text-success" : "text-faint",
                        )}
                      >
                        {preset.requires === "node" ? "Node.js" : "uv"}
                        {ready ? " · 可用" : " · 未检测到"}
                      </span>
                      <Button
                        size="sm"
                        variant={added ? "ghost" : "secondary"}
                        disabled={added || !ready || presetBusy === preset.id}
                        loading={presetBusy === preset.id}
                        onClick={() => void addPreset(preset)}
                      >
                        {added ? "已添加" : "添加"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-faint">
          GitHub 已在上方内置；邮箱等需要账号授权的服务仍要单独管理令牌。第三方 MCP 插件可能访问网络，请确认来源。
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="text-[13px] font-medium text-ink">
          已添加的连接器
          {connectors.length > 0 && (
            <span className="ml-1.5 text-[12px] font-normal text-faint">
              {connectors.length}
            </span>
          )}
        </div>
        <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={openNew}>
          添加连接器
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {connectors.length === 0 && (
          <div className="rounded-xl border border-dashed border-line px-5 py-7 text-center">
            <Plug size={20} className="mx-auto text-faint" />
            <p className="mt-2 text-[12.5px] text-muted">还没有连接器。</p>
            <p className="mt-1 text-[11.5px] leading-5 text-faint">
              可以接入文件系统、浏览器、数据库等支持 MCP 的本地服务。
              <br />
              例如：命令 <code className="font-mono">npx</code>，参数{" "}
              <code className="font-mono">-y @modelcontextprotocol/server-filesystem D:\Documents</code>
            </p>
          </div>
        )}

        {connectors.map((info) => {
          const busy = busyId === info.config.id;
          const expandedOpen = expanded === info.config.id;
          return (
            <div key={info.config.id} className="rounded-xl border border-line p-3.5">
              <div className="flex items-start gap-2.5">
                <div
                  className={clsx(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    info.connected
                      ? "bg-accent-soft text-accent"
                      : "bg-sidebar text-faint",
                  )}
                >
                  <Plug size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">
                      {info.config.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-muted">
                      <span
                        className={clsx(
                          "inline-block h-1.5 w-1.5 rounded-full",
                          info.connected
                            ? "bg-success"
                            : info.connecting
                              ? "bg-[#e0a53a]"
                              : "bg-faint",
                        )}
                      />
                      {info.connecting
                        ? "连接中…"
                        : info.connected
                          ? `已连接 · ${info.tools.length} 个工具`
                          : info.config.enabled
                            ? isTrusted(info)
                              ? "未连接"
                              : "未信任"
                            : "已停用"}
                    </span>
                    <span
                      className={clsx(
                        "rounded border px-1 py-px text-[9.5px]",
                        isTrusted(info)
                          ? "border-line bg-sidebar text-muted"
                          : "border-[#e0a53a]/35 bg-[#e0a53a]/10 text-[#a97616] dark:text-[#e0b35a]",
                      )}
                    >
                      {isTrusted(info) ? "已信任" : "未信任"}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-faint">
                    {commandPreview(info.config)}
                  </p>
                  {info.error && !info.connected && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] leading-4 text-danger">
                      <AlertCircle size={11} className="mt-[2px] shrink-0" />
                      <span className="break-all">{info.error}</span>
                    </p>
                  )}
                  {info.connected && info.tools.length > 0 && (
                    <button
                      onClick={() => setExpanded(expandedOpen ? null : info.config.id)}
                      className="mt-1.5 text-[11.5px] text-accent hover:underline"
                    >
                      {expandedOpen ? "收起工具" : "查看可用工具"}
                    </button>
                  )}
                  {expandedOpen && (
                    <div className="mt-1.5 space-y-1">
                      {info.tools.map((tool) => (
                        <div
                          key={tool.name}
                          className="rounded-lg bg-sidebar px-2.5 py-1.5 text-[11.5px] leading-4"
                        >
                          <span className="font-mono text-ink">{tool.name}</span>
                          {tool.description && (
                            <span className="ml-1.5 text-faint">{tool.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {info.config.enabled && !info.connected && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy}
                      icon={<RefreshCw size={12} />}
                      onClick={() => void connect(info)}
                    >
                      {isTrusted(info) ? "连接" : "确认并启动"}
                    </Button>
                  )}
                  <IconButton
                    label="测试连接"
                    size="sm"
                    disabled={busy}
                    onClick={() => void testExisting(info)}
                  >
                    <Wrench size={13} />
                  </IconButton>
                  {isTrusted(info) && (
                    <IconButton
                      label="撤销启动信任"
                      size="sm"
                      disabled={busy}
                      onClick={() => void revokeTrust(info)}
                    >
                      <ShieldOff size={13} />
                    </IconButton>
                  )}
                  <IconButton label="编辑" size="sm" onClick={() => openEdit(info)}>
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton label="删除" size="sm" onClick={() => remove(info)}>
                    <Trash2 size={13} />
                  </IconButton>
                  <Switch
                    checked={info.config.enabled}
                    disabled={busy}
                    label={`启用 ${info.config.name}`}
                    onChange={(value) => toggle(info, value)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-5 text-faint">
        <ShieldCheck size={13} className="mt-[3px] shrink-0" />
        连接器以你的 Windows 用户权限在本机运行。Mind 不经过任何中转服务器；工具参数和返回结果只发送给你选择的模型服务。启动确认和逐次工具审批不是进程级沙箱，无法阻止插件访问文件或网络。
      </p>
        </>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? "编辑连接器" : "添加连接器"}
        description="填写启动 MCP 服务的命令。保存时 Mind 会真实启动一次并读取工具列表。"
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              保存
            </Button>
          </>
        }
      >
        <Field label="名称">
          <Input
            value={form.name}
            onChange={(e) => updateForm({ name: e.target.value })}
            placeholder="例如：文件系统"
            autoFocus
          />
        </Field>
        <Field label="启动命令" hint="可执行文件或 npx / uvx" className="mt-3">
          <Input
            value={form.command}
            onChange={(e) => updateForm({ command: e.target.value })}
            placeholder="npx"
            spellCheck={false}
            className="font-mono text-[12.5px]"
          />
        </Field>
        <Field label="参数" hint="每行一个" className="mt-3">
          <Textarea
            rows={4}
            value={form.args}
            onChange={(e) => updateForm({ args: e.target.value })}
            placeholder={"-y\n@modelcontextprotocol/server-filesystem\nD:\\Documents"}
            spellCheck={false}
            className="font-mono text-[12px] leading-5"
          />
        </Field>

        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={testing}
            icon={<Wrench size={12} />}
            onClick={testDraft}
          >
            测试连接
          </Button>
          <span className="text-[11.5px] text-faint">只读取工具列表，不会执行任何工具。</span>
        </div>

        {testTools && (
          <div className="mt-2 rounded-lg border border-success/25 bg-success/5 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11.5px] text-success">
              <Check size={12} /> 连接成功，发现 {testTools.length} 个工具
            </p>
            {testTools.length > 0 && (
              <p className="mt-1 break-all text-[11px] leading-4 text-muted">
                {testTools.map((t) => t.name).join("、")}
              </p>
            )}
          </div>
        )}
        {testError && (
          <div className="mt-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[11.5px] leading-4 text-danger">
            <span className="flex items-start gap-1">
              <AlertCircle size={12} className="mt-[2px] shrink-0" />
              <span className="break-all">{testError}</span>
            </span>
          </div>
        )}
        {formError && (
          <div className="mt-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[11.5px] text-danger">
            {formError}
          </div>
        )}
      </Modal>

      <Modal
        open={githubOpen}
        onClose={() => setGithubOpen(false)}
        title="连接 GitHub"
        description="使用 Personal Access Token 读取你有权限访问的仓库。Token 只保存在 Windows 凭据管理器。"
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGithubOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={githubBusy}
              disabled={!githubToken.trim()}
              onClick={() => void connectGithub()}
            >
              连接并验证
            </Button>
          </>
        }
      >
        <ol className="space-y-2 text-[12px] leading-5 text-muted">
          <li className="flex gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-medium text-accent">
              1
            </span>
            <span>
              打开 GitHub 的 Personal access tokens 页面。建议创建 Fine-grained token，并只授权需要的仓库。
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-medium text-accent">
              2
            </span>
            <span>
              至少授予 Contents、Issues、Pull requests、Metadata 的只读权限；私有仓库需要对应的仓库访问权限。
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-medium text-accent">
              3
            </span>
            <span>复制 Token 并粘贴到下方。Mind 会用 /user 接口验证后再保存。</span>
          </li>
        </ol>

        <button
          onClick={() =>
            api.openExternal("https://github.com/settings/tokens").catch(() => {})
          }
          className="mt-2 flex items-center gap-1 text-[12px] text-accent hover:underline"
        >
          打开 GitHub Token 页面
          <ExternalLink size={11} />
        </button>

        <Field label="Personal Access Token" hint="仅保存在本机" className="mt-4">
          <div className="relative">
            <Input
              type={githubShowToken ? "text" : "password"}
              value={githubToken}
              onChange={(e) => {
                setGithubToken(e.target.value);
                setGithubError(null);
                setGithubDetail(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !githubBusy) void connectGithub();
              }}
              placeholder="github_pat_... 或 ghp_..."
              autoComplete="off"
              spellCheck={false}
              className="pr-10 font-mono text-[12.5px]"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setGithubShowToken((v) => !v)}
              className="absolute right-1 top-0.5 flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
              aria-label={githubShowToken ? "隐藏 Token" : "显示 Token"}
            >
              {githubShowToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        <button
          onClick={() => setGithubAdvanced((v) => !v)}
          className="mt-2 text-[11.5px] text-faint hover:text-muted"
        >
          {githubAdvanced ? "收起高级选项" : "GitHub Enterprise / 自定义 API 地址"}
        </button>
        {githubAdvanced && (
          <Field label="API 地址" hint="默认 https://api.github.com" className="mt-2">
            <Input
              value={githubBaseUrl}
              onChange={(e) => setGithubBaseUrl(e.target.value)}
              spellCheck={false}
              className="font-mono text-[12px]"
            />
          </Field>
        )}

        {githubError && (
          <div className="mt-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2">
            <p className="flex items-start gap-1.5 text-[12px] leading-5 text-danger">
              <AlertCircle size={13} className="mt-[3px] shrink-0" />
              <span>{githubError}</span>
            </p>
            {githubDetail && (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-panel/60 p-2 font-mono text-[10.5px] leading-4 text-muted">
                {githubDetail}
              </pre>
            )}
          </div>
        )}

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-faint">
          <ShieldCheck size={12} className="mt-[2px] shrink-0" />
          Token 不会写入 SQLite、设置文件或日志；请只授予读取权限。工具参数和返回结果会发送给你选择的模型服务。
        </p>
      </Modal>
    </section>
  );
}
