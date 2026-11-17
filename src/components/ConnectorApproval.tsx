import { Github, Plug, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useApprovalStore } from "../store/approvals";
import { Button, Modal } from "./ui";

export function ConnectorApprovalHost() {
  const pending = useApprovalStore((s) => s.pending);
  const resolve = useApprovalStore((s) => s.resolve);
  const [busy, setBusy] = useState(false);
  const request = pending[0];

  if (!request) return null;

  const answer = async (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    await resolve(request.approvalId, approved);
    setBusy(false);
  };

  let args = "{}";
  try {
    args = JSON.stringify(request.arguments ?? {}, null, 2);
  } catch {
    args = String(request.arguments);
  }

  const isGithub = request.server === "GitHub";

  return (
    <Modal
      open
      onClose={() => void answer(false)}
      title={isGithub ? "允许读取 GitHub？" : "允许使用连接器？"}
      description={
        isGithub
          ? "模型请求读取你的 GitHub 数据。只有在你同意后，Mind 才会调用 GitHub API。"
          : "模型请求调用你本机配置的软件。只有在你同意后，Mind 才会执行这次调用。"
      }
      width={500}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => void answer(false)}>
            拒绝
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void answer(true)}>
            允许一次
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-line bg-sidebar px-3.5 py-3">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          {isGithub ? (
            <Github size={13} className="text-accent" />
          ) : (
            <Plug size={13} className="text-accent" />
          )}
          <span className="truncate">{request.server}</span>
          <span className="text-faint">/</span>
          <span className="truncate font-mono text-[11.5px] text-ink">{request.tool}</span>
        </div>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-panel px-2.5 py-2 font-mono text-[10.5px] leading-4 text-muted">
          {args}
        </pre>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-5 text-faint">
        <ShieldAlert size={13} className="mt-[3px] shrink-0" />
        {isGithub
          ? "GitHub 是外部服务；仓库名、路径等参数和读取结果会发送给 GitHub 与模型服务。请确认无误。"
          : "连接器在你的电脑上以本地进程运行。请确认参数无误，不要允许来自不可信内容的操作。"}
        {pending.length > 1 && `（还有 ${pending.length - 1} 个请求等待处理）`}
      </p>
    </Modal>
  );
}
