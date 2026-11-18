import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Check, ChevronDown, ListChecks, PenLine } from "lucide-react";
import { useChatStore } from "../store/chat";

export interface AskQuestion {
  id: string;
  text: string;
  options?: string[];
}

const FENCE = /```ask[ \t]*\n([\s\S]*?)\n?\s*```/;

function makeFence() {
  return /```ask[ \t]*\n([\s\S]*?)\n?\s*```/g;
}

function parseQuestions(text: string): AskQuestion[] {
  const questions: AskQuestion[] = [];
  const fence = makeFence();
  let match: RegExpExecArray | null;
  fence.lastIndex = 0;
  while ((match = fence.exec(text)) !== null) {
    const body = match[1];
    const lines = body.split("\n");
    let current: AskQuestion | null = null;
    const flush = () => {
      if (current && current.text) questions.push(current);
      current = null;
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        // 空行不再结束当前问题：模型可能按示例在问题之间留空行，
        // 选项仍归属最近的 Qn。
        continue;
      }
      if (line.startsWith("-")) {
        const option = line.slice(1).trim();
        if (!option || !current) continue;
        current.options = [...(current.options ?? []), option];
        continue;
      }
      flush();
      const idMatch = /^Q(\d+)\s*(.*)$/i.exec(line);
      if (idMatch) {
        current = { id: idMatch[1], text: idMatch[2].trim() };
      } else {
        current = { id: String(questions.length + 1), text: line };
      }
    }
    flush();
  }
  return questions;
}

export function hasAskBlock(text: string): boolean {
  return FENCE.test(text);
}

export function splitAskBlocks(text: string): { text: string; questions: AskQuestion[] }[] {
  const parts: { text: string; questions: AskQuestion[] }[] = [];
  const fence = makeFence();
  let cursor = 0;
  let match: RegExpExecArray | null;
  fence.lastIndex = 0;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index), questions: [] });
    }
    parts.push({ text: "", questions: parseQuestions(match[1]) });
    cursor = fence.lastIndex;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), questions: [] });
  }
  return parts;
}

function AskBlock({
  questions,
  onSubmit,
  busy,
  answered,
}: {
  questions: AskQuestion[];
  onSubmit: (text: string) => void;
  busy: boolean;
  answered: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [fills, setFills] = useState<Record<string, string>>({});

  const answeredCount = questions.reduce(
    (acc, q) =>
      acc + ((selections[q.id] ?? fills[q.id]?.trim()) ? 1 : 0),
    0,
  );
  const allAnswered = answeredCount === questions.length;

  const answer = useMemo(() => {
    const lines: string[] = [];
    for (const q of questions) {
      const chosen = selections[q.id];
      const filled = fills[q.id]?.trim();
      if (chosen) lines.push(`${q.id}. ${q.text || "选择"}：${chosen}`);
      else if (filled) lines.push(`${q.id}. ${q.text || "填写"}：${filled}`);
    }
    if (lines.length === 0) {
      // 用户什么都没选/填就提交 → 视为跳过澄清，让 AI 直接基于原问题回答
      lines.push("（以上澄清我先跳过，请直接基于我的原问题继续回答）");
    }
    return lines.join("\n");
  }, [questions, selections, fills]);

  if (questions.length === 0) return null;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-panel">
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent">
          <ListChecks size={13} />
        </span>
        <span className="flex-1 text-[12.5px] font-medium text-ink">
          需要确认 {questions.length} 个信息
        </span>
        {answered ? (
          <span className="flex items-center gap-1 text-[11px] text-success">
            <Check size={12} /> 已提交
          </span>
        ) : (
          <ChevronDown
            size={13}
            className={clsx("text-faint transition-transform", !collapsed && "rotate-180")}
          />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-line px-3 py-3">
          {questions.map((q, index) => {
            const fillable = q.options == null || q.options.length === 0;
            return (
              <div key={q.id} className={clsx(index > 0 && "mt-3")}>
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <span className="mt-px flex h-5 min-w-[24px] shrink-0 items-center justify-center rounded bg-sidebar px-1 text-[10.5px] font-semibold text-muted">
                    Q{index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-5 text-ink">{q.text}</p>
                    {q.options && q.options.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {q.options.map((opt) => {
                          const active = selections[q.id] === opt;
                          return (
                            <button
                              key={opt}
                              disabled={busy || answered}
                              onClick={() =>
                                setSelections((prev) => ({ ...prev, [q.id]: opt }))
                              }
                              className={clsx(
                                "rounded-md border px-2 py-1 text-[12px] transition-colors disabled:opacity-50",
                                active
                                  ? "border-accent/50 bg-accent-soft text-accent"
                                  : "border-line text-muted hover:bg-hover hover:text-ink",
                              )}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {fillable && (
                      <input
                        disabled={busy || answered}
                        value={fills[q.id] ?? ""}
                        onChange={(e) =>
                          setFills((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !busy && !answered) onSubmit(answer);
                        }}
                        placeholder="填写补充信息，回车提交"
                        className="mt-1.5 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[12.5px] text-ink placeholder:text-faint focus:border-line-strong focus:outline-none disabled:opacity-50"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <button
              disabled={busy || answered}
              onClick={() => onSubmit(answer)}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 dark:text-[#0b1530]"
            >
              <PenLine size={13} />
              {allAnswered ? "提交回答" : "提交（已选/填完可直接提交）"}
            </button>
            <span className="text-[11px] text-faint">
              {answered
                ? "回答已发送"
                : `已回答 ${answeredCount}/${questions.length} · 点选选项或填写后提交，也可在下方输入框自由回答`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function hasPendingQuestion(content: string) {
  return /```ask\b/.test(content);
}
export { hasPendingQuestion };

export function AskRenderer({
  content,
  messageId,
  streaming = false,
}: {
  content: string;
  messageId: string;
  streaming?: boolean;
}) {
  const send = useChatStore((s) => s.send);
  const busy = useChatStore((s) => s.streaming !== null);
  const answered = useChatStore((s) => s.answeredQuestions[messageId] === true);
  const parts = useMemo(() => splitAskBlocks(content), [content]);
  if (parts.length === 0) return null;

  return (
    <>
      {parts.map((part, i) => (
        <div key={i}>
          {part.questions.length > 0 && !streaming && (
            <AskBlock
              questions={part.questions}
              onSubmit={(text) => {
                useChatStore.getState().markQuestionAnswered(messageId);
                void send(text, [], true);
              }}
              busy={busy}
              answered={answered}
            />
          )}
        </div>
      ))}
    </>
  );
}
