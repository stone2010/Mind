import { Code2, FileText, GitBranch, Lightbulb, PenLine, PieChart } from "lucide-react";
import { useAppStore } from "../store/app";

const SUGGESTIONS = [
  {
    icon: PenLine,
    title: "润色一段文字",
    description: "让表达更简洁、清晰",
    prompt: "帮我润色下面这段文字，使它更简洁清晰：\n\n",
  },
  {
    icon: Code2,
    title: "解释一段代码",
    description: "逐行说明代码的作用",
    prompt: "请逐行解释下面这段代码的作用：\n\n```\n\n```",
  },
  {
    icon: Lightbulb,
    title: "制定一个计划",
    description: "学习、健身或工作安排",
    prompt: "帮我制定一个为期四周的计划，主题是：",
  },
  {
    icon: FileText,
    title: "总结一份内容",
    description: "提炼核心要点",
    prompt: "请帮我总结下面这段内容的核心要点：\n\n",
  },
  {
    icon: GitBranch,
    title: "画一个流程图",
    description: "用 Mermaid 展示步骤关系",
    prompt:
      "请用 mermaid 代码块画一个流程图，主题是「用户从注册到完成下单」，只输出一个 ```mermaid 代码块。",
  },
  {
    icon: PieChart,
    title: "做一张数据图",
    description: "生成柱状图或饼图",
    prompt:
      '请用 ```chart 代码块输出一个 JSON 柱状图，标题为「2026 年季度销量」，labels 为 ["Q1","Q2","Q3","Q4"]，series 中放一组 name 和 values。只输出代码块。',
  },
];

export function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const demo = settings.demoMode;
  const model = providers
    .find((p) => p.id === settings.providerId)
    ?.models.find((m) => m.id === settings.modelId);

  return (
    <div className="flex h-full items-center justify-center px-5 pb-10 sm:px-6 sm:pb-16">
      <div className="w-full max-w-[600px]">
        <h1 className="text-[21px] font-semibold tracking-[-0.01em] text-ink sm:text-[24px]">
          有什么可以帮你的？
        </h1>
        <p className="mt-2 flex items-center gap-2 text-[13px] text-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          正在使用 {model?.label ?? "DeepSeek"}
          {demo && (
            <span className="rounded border border-line px-1.5 py-px text-[10.5px] text-faint">
              演示模式
            </span>
          )}
        </p>

        <p className="mt-1 text-[11.5px] text-faint">
          支持 Mermaid 流程图、chart 数据图和图片放大查看；用一句描述就能生成。
        </p>

        <div className="mt-6 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.title}
              onClick={() => onSuggestion(s.prompt)}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-hover"
            >
              <s.icon size={15} className="mt-[3px] shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{s.title}</span>
                <span className="mt-0.5 block text-[12px] text-faint">{s.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
