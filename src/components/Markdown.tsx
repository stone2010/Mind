import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, X } from "lucide-react";
import { api } from "../lib/bridge";
import { copyText } from "../lib/utils";
import { ChartBlock } from "./ChartBlock";
import { MermaidBlock } from "./MermaidBlock";

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function extractLang(children: ReactNode): string {
  for (const child of Children.toArray(children)) {
    if (isValidElement(child)) {
      const className = (child.props as { className?: string }).className ?? "";
      const match = /language-([\w+#.-]+)/.exec(className);
      if (match) return match[1];
    }
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = extractLang(children);
  const text = nodeText(children).replace(/\n$/, "");

  const onCopy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };

  if (lang === "mermaid") return <MermaidBlock code={text} />;
  if (lang === "chart" || lang === "mind-chart") return <ChartBlock code={text} />;

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang || "text"}</span>
        <button className="code-copy" onClick={onCopy} aria-label="复制代码">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const components = useMemo(
    () => ({
      pre: CodeBlock,
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href && /^https?:\/\//i.test(href)) {
              api.openExternal(href).catch(() => {});
            }
          }}
        >
          {children}
        </a>
      ),
      img: ({
        src,
        alt,
        title,
      }: {
        src?: string;
        alt?: string;
        title?: string;
      }) => {
        if (!src || !/^(https?:|data:image\/)/i.test(src)) return null;
        return (
          <img
            src={src}
            alt={alt ?? ""}
            title={title}
            className="cursor-zoom-in"
            loading="lazy"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setPreview(src);
            }}
          />
        );
      },
    }),
    [],
  );

  return (
    <>
      <div className="md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, [rehypeHighlight, { ignoreMissing: true }]]}
          components={components}
          urlTransform={(url, key) =>
            key === "src" && /^data:image\//i.test(url)
              ? url
              : defaultUrlTransform(url)
          }
        >
          {content}
        </ReactMarkdown>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <button
            onClick={() => setPreview(null)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="关闭图片预览"
          >
            <X size={18} />
          </button>
          <img
            src={preview}
            alt="图片预览"
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
});
