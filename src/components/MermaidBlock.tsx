import { useEffect, useId, useState } from "react";
import { useAppStore } from "../store/app";

export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const theme = useAppStore((s) => s.settings.theme);
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
          themeVariables: {
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
    <div
      className="mermaid-block my-3 overflow-x-auto rounded-xl border border-line bg-panel p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
