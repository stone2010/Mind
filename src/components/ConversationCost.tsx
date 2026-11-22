import { ReceiptText } from "lucide-react";
import { formatFen, summarizeUsage } from "../lib/pricing";
import { useIsMobileLayout } from "../lib/useIsMobile";
import { useAppStore } from "../store/app";
import { useChatStore } from "../store/chat";

export function ConversationCost({ conversationId }: { conversationId: string | null }) {
  const logs = useChatStore((s) =>
    conversationId ? s.usageByConversation[conversationId] : undefined,
  );
  const settings = useAppStore((s) => s.settings);
  const setView = useAppStore((s) => s.setView);
  const mobile = useIsMobileLayout();

  // On phones the header needs the space for the title; costs stay available in
  // 设置 → 用量与费用.
  if (mobile || !conversationId || !settings.usageEnabled || !logs?.length) return null;
  const summary = summarizeUsage(logs, settings);
  if (summary.totalTokens <= 0) return null;

  return (
    <button
      onClick={() => setView({ name: "settings", section: "usage" })}
      title="按模型价格估算；DeepSeek 使用官方峰谷价。点击查看用量明细。"
      className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-sidebar px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      <ReceiptText size={11} className="text-accent" />
      本对话
      {summary.hasUnknownModel ? (
        <span className="text-[#b07a1c] dark:text-[#e0b35a]">价格未配置</span>
      ) : (
        <span className="font-medium text-ink">≈{formatFen(summary.totalCost)}</span>
      )}
    </button>
  );
}
