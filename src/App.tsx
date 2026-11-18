import { useEffect, useState } from "react";
import { api, listenConnectorApprovals } from "./lib/bridge";
import { useIsMobileLayout } from "./lib/useIsMobile";
import { systemThemeListener, useAppStore } from "./store/app";
import { useApprovalStore } from "./store/approvals";
import { useChatStore } from "./store/chat";
import { ConnectorApprovalHost } from "./components/ConnectorApproval";
import { LegalGate } from "./components/LegalGate";
import { SearchDialog } from "./components/SearchDialog";
import { ConfirmHost, Toasts } from "./components/Feedback";
import { ChatView } from "./components/ChatView";
import { Onboarding } from "./components/Onboarding";
import { ProjectsView } from "./components/ProjectsView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { Logo, Spinner } from "./components/ui";

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const fatalError = useAppStore((s) => s.fatalError);
  const needsOnboarding = useAppStore((s) => s.needsOnboarding);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const activeId = useChatStore((s) => s.activeId);
  const mobile = useIsMobileLayout();
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [view, activeId]);

  useEffect(() => {
    void useAppStore.getState().init();
    return systemThemeListener();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenConnectorApprovals((request) => useApprovalStore.getState().push(request))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const raf = requestAnimationFrame(() => {
      api.appReady().catch(() => {});
    });
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        useChatStore.getState().newChat();
        setView({ name: "chat" });
        requestAnimationFrame(() => document.getElementById("composer-input")?.focus());
      } else if (key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === ",") {
        e.preventDefault();
        setView({ name: "settings", section: "general" });
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("input, textarea, [contenteditable='true'], pre")) {
        e.preventDefault();
      }
    };
    const preventDrop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("dragover", preventDrop);
    window.addEventListener("drop", preventDrop);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("dragover", preventDrop);
      window.removeEventListener("drop", preventDrop);
    };
  }, [setView]);

  if (!ready) {
    return (
      <div className="flex h-full flex-col bg-bg">
        {!mobile && <TitleBar />}
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Logo height={38} />
          <Spinner size={16} className="text-faint" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      {!mobile && <TitleBar />}
      <div className="flex min-h-0 flex-1">
        {fatalError ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-[420px] text-center">
              <p className="text-[15px] font-medium text-ink">Mind 无法启动</p>
              <p className="mt-2 text-[12.5px] leading-5 text-muted">
                初始化本地数据时出错。请重新启动应用；如果问题持续存在，请查看详细错误。
              </p>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-sidebar p-3 text-left font-mono text-[10.5px] leading-4 text-muted">
                {fatalError}
              </pre>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-hover"
              >
                重新加载
              </button>
            </div>
          </div>
        ) : needsOnboarding ? (
          <Onboarding />
        ) : view.name === "settings" ? (
          <SettingsView />
        ) : (
          <>
            {!mobile && <Sidebar onOpenSearch={() => setSearchOpen(true)} />}
            <main className="flex min-w-0 flex-1 flex-col">
              {view.name === "chat" && (
                <ChatView mobile={mobile} onOpenSidebar={() => setDrawerOpen(true)} />
              )}
              {view.name === "projects" && (
                <ProjectsView mobile={mobile} onOpenSidebar={() => setDrawerOpen(true)} />
              )}
            </main>
            {mobile && drawerOpen && (
              <div className="fixed inset-0 z-50">
                <div
                  className="absolute inset-0 bg-black/35"
                  onClick={() => setDrawerOpen(false)}
                />
                <div className="relative h-full w-[280px] shadow-2xl">
                  <Sidebar
                    mobile
                    onClose={() => setDrawerOpen(false)}
                    onOpenSearch={() => {
                      setDrawerOpen(false);
                      setSearchOpen(true);
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <SearchDialog open={searchOpen && !needsOnboarding} onClose={() => setSearchOpen(false)} />
      <ConnectorApprovalHost />
      <LegalGate />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
