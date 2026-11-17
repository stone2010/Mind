import { getCurrentWindow } from "@tauri-apps/api/window";
import { ExternalLink, Scale, ShieldCheck } from "lucide-react";
import { api } from "../lib/bridge";
import { useAppStore } from "../store/app";
import { pushToast } from "../store/toast";
import { Button, Modal } from "./ui";

export const LEGAL_VERSION = "2026-11-17";

export function LegalGate() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const ready = useAppStore((s) => s.ready);

  if (!ready || settings.legalAccepted === LEGAL_VERSION) return null;

  const agree = async () => {
    await updateSettings({ legalAccepted: LEGAL_VERSION });
    pushToast({ kind: "success", title: "已同意用户协议与隐私说明" });
  };

  const exit = () => {
    getCurrentWindow()
      .close()
      .catch(() => {});
  };

  return (
    <Modal
      open
      onClose={exit}
      title="使用前请阅读"
      description="Mind 是本地 AI 客户端。AI 输出可能不准确，工具和第三方服务也有风险；请先阅读并同意以下文件。"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={exit}>
            不同意并退出
          </Button>
          <Button variant="primary" onClick={() => void agree()}>
            同意并继续
          </Button>
        </>
      }
    >
      <div className="space-y-2.5 text-[12px] leading-5 text-muted">
        <p className="flex items-start gap-2">
          <ShieldCheck size={13} className="mt-[3px] shrink-0 text-accent" />
          聊天记录、记忆和用量保存在本机；API Key 和 GitHub Token 存入 Windows 凭据管理器。Mind 没有自己的模型服务器。
        </p>
        <p className="flex items-start gap-2">
          <Scale size={13} className="mt-[3px] shrink-0 text-accent" />
          AI 内容不构成法律、医疗、金融或其他专业建议。第三方模型、GitHub 和 MCP 插件各有自己的条款与隐私政策。
        </p>
        <p className="text-[11.5px] leading-5 text-faint">
          你也可以随时在“设置 → 关于”中重新查看这些文件。
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() =>
            api
              .openExternal(
                "https://github.com/stone2010/Mind/blob/main/docs/USER_AGREEMENT.md",
              )
              .catch(() => {})
          }
          className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-accent hover:bg-hover"
        >
          用户协议
          <ExternalLink size={11} />
        </button>
        <button
          onClick={() =>
            api
              .openExternal(
                "https://github.com/stone2010/Mind/blob/main/docs/PRIVACY.md",
              )
              .catch(() => {})
          }
          className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-accent hover:bg-hover"
        >
          隐私说明
          <ExternalLink size={11} />
        </button>
      </div>
    </Modal>
  );
}
