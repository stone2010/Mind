import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/app";
import { Logo } from "./ui";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const view = useAppStore((s) => s.view);
  const needsOnboarding = useAppStore((s) => s.needsOnboarding);
  const showBrand = !needsOnboarding && view.name === "settings";
  const appWindow = getCurrentWindow();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then(setMaximized).catch(() => {});
    appWindow
      .onResized(() => {
        appWindow.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-[38px] shrink-0 select-none items-center border-b border-line bg-bg"
    >
      <div data-tauri-drag-region className="flex h-full flex-1 items-center gap-2 pl-3">
        {showBrand && (
          <>
            <Logo height={15} />
            <span
              data-tauri-drag-region
              className="text-[12px] font-medium tracking-[0.01em] text-muted"
            >
              Mind
            </span>
          </>
        )}
      </div>
      <div className="flex h-full items-stretch">
        <button
          className="titlebar-btn"
          aria-label="最小化"
          onClick={() => appWindow.minimize()}
        >
          <Minus size={14} strokeWidth={1.6} />
        </button>
        <button
          className="titlebar-btn"
          aria-label={maximized ? "还原" : "最大化"}
          onClick={() => appWindow.toggleMaximize()}
        >
          {maximized ? (
            <Copy size={12} strokeWidth={1.6} />
          ) : (
            <Square size={11.5} strokeWidth={1.6} />
          )}
        </button>
        <button
          className="titlebar-btn close"
          aria-label="关闭"
          onClick={() => appWindow.close()}
        >
          <X size={15} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  );
}
