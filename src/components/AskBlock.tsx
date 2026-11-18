import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { ArrowUp, Check, ChevronDown, ListChecks, PenLine } from "lucide-react";
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

function parseAskBody(body: string): AskQuestion[] {
  const questions: AskQuestion[] = [];
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
  return questions;
}

function parseQuestions(text: string): AskQuestion[] {
  const fence = makeFence();
  const questions: AskQuestion[] = [];
  let match: RegExpExecArray | null;
  fence.lastIndex = 0;
  while ((match = fence.exec(text)) !== null) {
    questions.push(...parseAskBody(match[1]));
  }
  // `splitAskBlocks` already passes the fenced body itself.
  return questions.length > 0 ? questions : parseAskBody(text);
}

export function hasAskBlock(text: string): boolean {
  return FENCE.test(text);
}

export function stripAskBlocks(text: string): string {
  return text
    .replace(makeFence(), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const [sent, setSent] = useState(false);

  const answeredCount = questions.reduce(
    (acc, q) =>
      acc + ((selections[q.id] ?? fills[q.id]?.trim()) ? 1 : 0),
    0,
  );
  const allAnswered = answeredCount === questions.length;

  const composeAnswer = (
    selected: Record<string, string> = selections,
    filledValues: Record<string, string> = fills,
  ) => {
    const lines: string[] = [];
    for (const q of questions) {
      const chosen = selected[q.id];
      const filled = filledValues[q.id]?.trim();
      if (chosen) lines.push(`${q.id}. ${q.text || "选择"}：${chosen}`);
      else if (filled) lines.push(`${q.id}. ${q.text || "填写"}：${filled}`);
    }
    if (lines.length === 0) {
      // 用户什么都没选/填就提交 → 视为跳过澄清，让 AI 直接基于原问题回答
      lines.push("（以上澄清我先跳过，请直接基于我的原问题继续回答）");
    }
    return lines.join("\n");
  };

  const submitAnswer = (
    selected: Record<string, string> = selections,
    filledValues: Record<string, string> = fills,
  ) => {
    if (busy || answered || sent) return;
    setSent(true);
    onSubmit(composeAnswer(selected, filledValues));
  };

  const chooseOption = (question: AskQuestion, option: string) => {
    if (busy || answered || sent) return;
    const next = { ...selections, [question.id]: option };
    setSelections(next);
    const complete = questions.every(
      (q) => next[q.id] || fills[q.id]?.trim(),
    );
    // 单选题点选项即发送；多选题在所有问题都有答案后自动发送。
    if (questions.length === 1 || complete) {
      submitAnswer(next, fills);
    }
  };

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
        {answered || sent ? (
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
                              disabled={busy || answered || sent}
                              onClick={() => chooseOption(q, opt)}
                              className={clsx(
                                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors disabled:opacity-50",
                                active
                                  ? "border-accent/50 bg-accent-soft text-accent"
                                  : "border-line text-muted hover:border-line-strong hover:bg-hover hover:text-ink",
                              )}
                            >
                              {active && <Check size={12} />}
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {fillable && (
                      <div className="mt-2 rounded-lg border border-line bg-bg p-2 transition-colors focus-within:border-line-strong">
                        <textarea
                          disabled={busy || answered || sent}
                          value={fills[q.id] ?? ""}
                          onChange={(e) =>
                            setFills((prev) => ({ ...prev, [q.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              submitAnswer();
                            }
                          }}
                          rows={2}
                          placeholder="在这里输入你的回答…"
                          className="block max-h-32 min-h-[38px] w-full resize-none bg-transparent px-1 py-0.5 text-[13px] leading-5 text-ink placeholder:text-faint focus:outline-none disabled:opacity-50"
                        />
                        <div className="mt-1 flex justify-end">
                          <button
                            disabled={busy || answered || sent || !fills[q.id]?.trim()}
                            onClick={() => submitAnswer()}
                            className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40 dark:text-[#0b1530]"
                          >
                            <ArrowUp size={12} />
                            发送回答
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <button
              disabled={busy || answered || sent}
              onClick={() => submitAnswer()}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 dark:text-[#0b1530]"
            >
              <PenLine size={13} />
              {allAnswered ? "提交回答" : "提交当前回答"}
            </button>
            <span className="text-[11px] text-faint">
              {answered || sent
                ? "回答已发送"
                : questions.length === 1
                  ? "点选项直接发送；文本题填写后点发送"
                  : `已回答 ${answeredCount}/${questions.length} · 选项会记录选择，全部答完自动发送`}
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
