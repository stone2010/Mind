import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Download, Workflow } from "lucide-react";
import { copyText } from "../lib/utils";
import { useAppStore } from "../store/app";

export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const theme = useAppStore((s) => s.settings.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const rawId = useId();
  const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    setSvg("");
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          flowchart: {
            curve: "basis",
            nodeSpacing: 32,
            rankSpacing: 46,
            padding: 10,
            useMaxWidth: true,
          },
          themeVariables: {
            fontSize: "14px",
            primaryColor: dark ? "#2b4a7a" : "#e8efff",
            primaryTextColor: dark ? "#e9ebee" : "#181b20",
            primaryBorderColor: dark ? "#7aa8ff" : "#346df5",
            lineColor: dark ? "#7d8792" : "#8b929d",
            secondaryColor: dark ? "#26313f" : "#f1f3f7",
            tertiaryColor: dark ? "#1b1e22" : "#ffffff",
          },
        });
        const rendered = await mermaid.render(id, code);
        if (alive) setSvg(rendered.svg);
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }, 40);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [code, dark, id, theme]);

  const downloadSvg = () => {
    const source = containerRef.current?.querySelector("svg");
    if (!source) return;
    const clone = source.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mind-diagram.svg";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="my-3 rounded-xl border border-danger/25 bg-danger-soft p-3">
        <p className="text-[12px] text-danger">Mermaid 图表渲染失败。</p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-panel/70 p-2 font-mono text-[10.5px] leading-4 text-muted">
          {code}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 flex h-32 items-center justify-center rounded-xl border border-line bg-panel text-[12px] text-faint">
        正在渲染图表…
      </div>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center gap-2 border-b border-line/80 bg-sidebar/60 px-3.5 py-2">
        <Workflow size={13} className="text-accent" />
        <span className="flex-1 text-[11.5px] font-medium text-muted">流程图</span>
        <button
          onClick={async () => {
            if (await copyText(code)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }
          }}
          aria-label="复制图表代码"
          title="复制图表代码"
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
        <button
          onClick={downloadSvg}
          aria-label="下载图表 SVG"
          title="下载 SVG"
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <Download size={13.5} />
        </button>
      </div>
      <div
        ref={containerRef}
        className="mermaid-block max-h-[72vh] overflow-auto p-4"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
