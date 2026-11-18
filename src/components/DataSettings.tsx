import { open, save } from "@tauri-apps/plugin-dialog";
import {
  CloudOff,
  DatabaseBackup,
  Download,
  FolderOpen,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { api, errorMessage } from "../lib/bridge";
import { isMobilePlatform } from "../lib/platform";
import { copyText } from "../lib/utils";
import { useAppStore } from "../store/app";
import { useChatStore } from "../store/chat";
import { confirmDialog } from "../store/confirm";
import { pushToast } from "../store/toast";
import type { ImportResult } from "../types";
import { Button, Modal, Switch, Textarea } from "./ui";

function today() {
  const date = new Date();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function DataSettings() {
  const mobile = isMobilePlatform();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const finishImport = async (result: ImportResult) => {
    const app = useAppStore.getState();
    await app.refreshProjects();
    await app.refreshMemories();
    await app.refreshGithub();
    const chat = useChatStore.getState();
    chat.newChat();
    useChatStore.setState({ messages: {}, usageByConversation: {} });
    await chat.loadConversations();
    pushToast({
      kind: "success",
      title: replaceOnImport ? "备份已覆盖导入" : "备份已合并导入",
      detail: `${result.conversations} 个对话、${result.messages} 条消息、${result.memories} 条记忆、${result.usage} 条用量记录`,
    });
  };

  const exportData = async () => {
    if (useChatStore.getState().streaming) {
      pushToast({ kind: "info", title: "请先停止当前生成，再导出备份。" });
      return;
    }
    if (mobile) {
      setExporting(true);
      try {
        const json = await api.dataExportJson();
        setExportJson(json);
        setLastExport(`mind-backup-${today()}.json`);
        pushToast({
          kind: "success",
          title: "备份已生成",
          detail: "请复制全部内容，保存为 .json 文件。",
        });
      } catch (err) {
        pushToast({ kind: "error", title: "导出失败", detail: errorMessage(err) });
      } finally {
        setExporting(false);
      }
      return;
    }
    try {
      const path = await save({
        title: "导出 Mind 备份",
        defaultPath: `mind-backup-${today()}.json`,
        filters: [{ name: "Mind 备份", extensions: ["json"] }],
      });
      if (!path) return;
      setExporting(true);
      const result = await api.dataExport(path);
      setLastExport(result.path);
      pushToast({
        kind: "success",
        title: "备份已导出",
        detail: `${result.conversations} 个对话、${result.messages} 条消息、${result.memories} 条记忆、${result.usage} 条用量记录`,
      });
    } catch (err) {
      pushToast({ kind: "error", title: "导出失败", detail: errorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  const importData = async () => {
    if (useChatStore.getState().streaming) {
      pushToast({ kind: "info", title: "请先停止当前生成，再导入备份。" });
      return;
    }
    if (mobile) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const selected = await open({
        title: "选择 Mind 备份",
        multiple: false,
        directory: false,
        filters: [{ name: "Mind 备份", extensions: ["json"] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;

      const ok = await confirmDialog({
        title: replaceOnImport ? "覆盖现有数据？" : "导入备份？",
        body: replaceOnImport
          ? "当前所有对话、项目、记忆和用量记录会被删除，然后替换为备份内容。API Key、GitHub Token 和设置不会改变。此操作不可撤销。"
          : "备份中的对话、项目、记忆和用量会合并到本机；相同 ID 会被备份内容覆盖。API Key、GitHub Token 和设置不会改变。",
        confirmLabel: replaceOnImport ? "覆盖并导入" : "导入",
        danger: replaceOnImport,
      });
      if (!ok) return;

      setImporting(true);
      const result = await api.dataImport(path, replaceOnImport);
      await finishImport(result);
    } catch (err) {
      pushToast({ kind: "error", title: "导入失败", detail: errorMessage(err) });
    } finally {
      setImporting(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const ok = await confirmDialog({
      title: replaceOnImport ? "覆盖现有数据？" : "导入备份？",
      body: replaceOnImport
        ? "当前所有对话、项目、记忆和用量记录会被删除，然后替换为备份内容。API Key、GitHub Token 和设置不会改变。此操作不可撤销。"
        : "备份中的对话、项目、记忆和用量会合并到本机；相同 ID 会被备份内容覆盖。API Key、GitHub Token 和设置不会改变。",
      confirmLabel: replaceOnImport ? "覆盖并导入" : "导入",
      danger: replaceOnImport,
    });
    if (!ok) return;
    setImporting(true);
    try {
      const content = await file.text();
      const result = await api.dataImportJson(content, replaceOnImport);
      await finishImport(result);
    } catch (err) {
      pushToast({ kind: "error", title: "导入失败", detail: errorMessage(err) });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <section>
      <div>
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
          数据与备份
        </h2>
        <p className="mt-1 text-[12.5px] leading-5 text-muted">
          导出或导入本机的对话、消息、项目、记忆和用量记录。API Key、GitHub Token
          与设置不包含在备份中。
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-line p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Download size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">导出备份</div>
            <p className="mt-0.5 text-[12px] leading-5 text-muted">
              生成一个 JSON 文件，可用于换机、手动同步或长期归档。备份不包含任何密钥。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<DatabaseBackup size={13} />}
                loading={exporting}
                onClick={() => void exportData()}
              >
                导出 JSON 备份
              </Button>
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
            </div>
            {lastExport && (
              <p className="mt-2 select-all break-all font-mono text-[10.5px] text-faint">
                {lastExport}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-line p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar text-muted">
            <Upload size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">导入备份</div>
            <p className="mt-0.5 text-[12px] leading-5 text-muted">
              从 Mind 导出的 JSON 文件恢复数据。默认合并；开启覆盖后会先清空当前对话数据。
            </p>
            <div className="mt-3 flex items-center justify-between gap-4 rounded-lg bg-sidebar px-3 py-2">
              <div>
                <div className="text-[11.5px] font-medium text-ink">覆盖现有数据</div>
                <div className="text-[10.5px] text-faint">不可撤销；不影响密钥和设置</div>
              </div>
              <Switch
                checked={replaceOnImport}
                label="导入时覆盖现有数据"
                onChange={setReplaceOnImport}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={<Upload size={13} />}
              loading={importing}
              onClick={() => void importData()}
              className="mt-3"
            >
              选择 JSON 备份并导入
            </Button>
            {mobile && (
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => void importFile(e.target.files?.[0])}
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-line p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar text-faint">
            <CloudOff size={16} />
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink">局域网自动同步</div>
            <p className="mt-0.5 text-[12px] leading-5 text-muted">
              暂未实现。真正的自动同步需要设备配对、鉴权、冲突合并和后台传输；当前推荐使用
              JSON 备份放到 OneDrive / 坚果云等同步盘，实现手动跨设备迁移。
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-5 text-faint">
        <ShieldCheck size={13} className="mt-[3px] shrink-0" />
        备份文件包含聊天内容和记忆，可能涉及隐私；请保存到你信任的位置，不要上传到不可信服务。
      </p>

      {mobile && (
        <p className="mt-2 text-[11px] leading-5 text-faint">
          Android 预览版不能直接写入系统下载目录：导出时复制备份内容并保存为 JSON 文件，导入时从文件选择器读取。
        </p>
      )}

      <Modal
        open={!!exportJson}
        onClose={() => setExportJson(null)}
        title="导出备份"
        description={`共 ${exportJson?.length.toLocaleString("zh-CN") ?? 0} 个字符。复制全部内容，保存为 ${lastExport ?? "mind-backup.json"}。`}
        width={620}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportJson(null)}>
              关闭
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (exportJson && (await copyText(exportJson))) {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }
              }}
            >
              {copied ? "已复制" : "复制全部内容"}
            </Button>
          </>
        }
      >
        <Textarea
          readOnly
          rows={10}
          value={exportJson ?? ""}
          className="font-mono text-[11px]"
          onFocus={(e) => e.currentTarget.select()}
        />
      </Modal>
    </section>
  );
}
