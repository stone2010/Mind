import { ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../store/chat";
import type { Message } from "../types";
import { EmptyState } from "./EmptyState";
import { MessageItem } from "./MessageItem";
import { Spinner } from "./ui";

export function MessageList({
  conversationId,
  messages,
  streamingMessageId,
  onSuggestion,
}: {
  conversationId: string | null;
  messages: Message[];
  streamingMessageId: string | null;
  onSuggestion: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const loading = useChatStore((s) => s.loading);

  const last = messages[messages.length - 1];

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    stickRef.current = true;
    setShowJump(false);
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance < 120;
    setShowJump(distance > 280);
  };

  useEffect(() => {
    stickRef.current = true;
    setShowJump(false);
    const raf = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(raf);
  }, [conversationId]);

  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages.length, last?.content, last?.reasoning]);

  // A new user message always means "follow the reply", even if a previous
  // layout shift had temporarily detached us from the bottom.
  const userCount = messages.filter((m) => m.role === "user").length;
  const prevUserCount = useRef(userCount);
  useEffect(() => {
    if (userCount > prevUserCount.current) {
      stickRef.current = true;
      setShowJump(false);
      requestAnimationFrame(() => scrollToBottom());
    }
    prevUserCount.current = userCount;
  }, [userCount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (loading && messages.length === 0) {
    return (
      <div className="relative flex flex-1 items-center justify-center">
        <Spinner size={20} className="text-faint" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ overflowAnchor: "none" }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <EmptyState onSuggestion={onSuggestion} />
        ) : (
          <div className="mx-auto w-full max-w-[780px] px-5 pb-8 pt-5">
            {messages.map((m, i) => (
              <MessageItem
                key={m.id}
                message={m}
                streaming={m.id === streamingMessageId}
                isLast={i === messages.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {showJump && messages.length > 0 && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] text-muted shadow-pop transition-colors hover:text-ink"
        >
          <ArrowDown size={13} />
          回到底部
        </button>
      )}
    </div>
  );
}
