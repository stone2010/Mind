import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  FolderClosed,
  FolderInput,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import { groupConversations } from "../lib/utils";
import { useAppStore } from "../store/app";
import { useChatStore } from "../store/chat";
import { confirmDialog } from "../store/confirm";
import type { Conversation } from "../types";
import { FloatingMenu, type MenuItem } from "./Menu";
import { IconButton, Logo, Modal, Button } from "./ui";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-4 px-2.5 text-[11px] font-medium text-faint first:mt-1">
      {children}
    </div>
  );
}

function ConversationRow({
  conv,
  active,
  collapsed,
  onMenu,
  renaming,
  setRenaming,
}: {
  conv: Conversation;
  active: boolean;
  collapsed: boolean;
  onMenu: (e: React.MouseEvent, conv: Conversation) => void;
  renaming: boolean;
  setRenaming: (id: string | null) => void;
}) {
  const openConversation = useChatStore((s) => s.openConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const setView = useAppStore((s) => s.setView);
  const [value, setValue] = useState(conv.title);

  if (collapsed) return null;

  const open = () => {
    if (renaming) return;
    setView({ name: "chat" });
    void openConversation(conv.id);
  };

  return (
    <div
      className={clsx(
        "group/row relative flex h-[32px] items-center rounded-lg pr-1 transition-colors",
        active ? "bg-active" : "hover:bg-hover",
      )}
    >
      {renaming ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const trimmed = value.trim();
            if (trimmed && trimmed !== conv.title) void renameConversation(conv.id, trimmed);
            setRenaming(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setValue(conv.title);
              setRenaming(null);
            }
          }}
          className="mx-2 h-[24px] min-w-0 flex-1 rounded border border-accent/50 bg-panel px-1.5 text-[12.5px] text-ink"
        />
      ) : (
        <button
          onClick={open}
          className={clsx(
            "flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 text-left text-[12.5px]",
            active ? "text-ink" : "text-muted group-hover/row:text-ink",
          )}
          title={conv.title}
        >
          <span className="truncate">{conv.title}</span>
          {conv.pinned && <Pin size={10.5} className="shrink-0 text-faint" />}
        </button>
      )}
      {!renaming && (
        <button
          onClick={(e) => onMenu(e, conv)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-active hover:text-ink group-hover/row:opacity-100 focus-visible:opacity-100"
          aria-label="对话操作"
        >
          <MoreHorizontal size={14} />
        </button>
      )}
    </div>
  );
}

export function Sidebar({
  onOpenSearch,
  mobile = false,
  onClose,
}: {
  onOpenSearch: () => void;
  mobile?: boolean;
  onClose?: () => void;
}) {
  const collapsedSetting = useAppStore((s) => s.settings.sidebarCollapsed);
  const collapsed = mobile ? false : collapsedSetting;
  const updateSettings = useAppStore((s) => s.updateSettings);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const projects = useAppStore((s) => s.projects);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const newChat = useChatStore((s) => s.newChat);
  const setPinned = useChatStore((s) => s.setPinned);
  const setArchived = useChatStore((s) => s.setArchived);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const moveToProject = useChatStore((s) => s.moveToProject);

  const [menu, setMenu] = useState<{ x: number; y: number; conv: Conversation } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [movingConv, setMovingConv] = useState<Conversation | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");

  const visible = conversations.filter((c) => !c.archived);
  const archived = conversations.filter((c) => c.archived);
  const { pinned, groups } = groupConversations(visible);

  const startNewChat = () => {
    newChat();
    setView({ name: "chat" });
    requestAnimationFrame(() => document.getElementById("composer-input")?.focus());
  };

  const toggleCollapsed = () => updateSettings({ sidebarCollapsed: !collapsed });

  const openMenu = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: rect.right - 188, y: rect.bottom + 4, conv });
  };

  const menuItems = (conv: Conversation): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: "重命名",
        icon: <Pencil size={13} />,
        onClick: () => {
          setRenamingId(conv.id);
        },
      },
      {
        label: conv.pinned ? "取消置顶" : "置顶",
        icon: conv.pinned ? <PinOff size={13} /> : <Pin size={13} />,
        onClick: () => setPinned(conv.id, !conv.pinned),
      },
      {
        label: conv.archived ? "取消归档" : "归档",
        icon: conv.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />,
        onClick: () => setArchived(conv.id, !conv.archived),
      },
      {
        label: "移动到项目",
        icon: <FolderInput size={13} />,
        onClick: () => {
          setMovingConv(conv);
          setMoveTarget(conv.projectId ?? "");
        },
      },
      {
        label: "删除对话",
        icon: <Trash2 size={13} />,
        danger: true,
        separator: true,
        onClick: async () => {
          const ok = await confirmDialog({
            title: "删除这个对话？",
            body: "对话及其中的消息将从本地永久删除，无法恢复。",
            confirmLabel: "删除",
            danger: true,
          });
          if (ok) void deleteConversation(conv.id);
        },
      },
    ];
    return items;
  };

  const NavButton = ({
    icon: Icon,
    label,
    active,
    onClick,
  }: {
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    label: string;
    active?: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={clsx(
        "flex h-8 w-full items-center gap-2.5 rounded-lg text-[13px] transition-colors",
        collapsed ? "justify-center" : "px-2.5",
        active ? "bg-active text-ink" : "text-muted hover:bg-hover hover:text-ink",
      )}
    >
      <Icon size={16} strokeWidth={1.7} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );

  return (
    <aside
      style={{ width: mobile ? 280 : collapsed ? 60 : 248 }}
      className="flex h-full shrink-0 flex-col border-r border-line bg-sidebar"
    >
      <div
        className={clsx(
          "flex shrink-0 items-center gap-2",
          mobile ? "h-14" : "h-11",
          collapsed ? "justify-center px-2" : "px-3",
        )}
      >
        {collapsed ? (
          <button onClick={toggleCollapsed} title="展开侧边栏" className="rounded-md p-1 hover:bg-hover">
            <Logo height={21} />
          </button>
        ) : (
          <>
            <Logo height={21} />
            <span className="flex-1 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
              Mind
            </span>
            {mobile ? (
              <IconButton label="关闭侧边栏" size="sm" onClick={() => onClose?.()}>
                <X size={17} />
              </IconButton>
            ) : (
              <IconButton label="收起侧边栏" size="sm" onClick={toggleCollapsed}>
                <PanelLeftClose size={15} />
              </IconButton>
            )}
          </>
        )}
      </div>

      <div className={clsx("space-y-1", collapsed ? "px-2" : "px-2.5")}>
        <button
          onClick={startNewChat}
          title={collapsed ? "新建对话" : undefined}
          className={clsx(
            "flex h-9 items-center rounded-lg border border-line bg-panel text-[13px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-hover",
            collapsed ? "w-full justify-center" : "w-full gap-2 px-2.5",
          )}
        >
          <Plus size={15.5} className="text-accent" />
          {!collapsed && (
            <>
              <span>新建对话</span>
              {!mobile && (
                <span className="ml-auto text-[10.5px] font-normal text-faint">Ctrl N</span>
              )}
            </>
          )}
        </button>

        <button
          onClick={onOpenSearch}
          title={collapsed ? "搜索对话" : undefined}
          className={clsx(
            "flex h-8 items-center rounded-lg text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink",
            collapsed ? "w-full justify-center" : "w-full gap-2.5 px-2.5",
          )}
        >
          <Search size={15} strokeWidth={1.8} />
          {!collapsed && (
            <>
              <span>搜索对话</span>
              {!mobile && <span className="ml-auto text-[10.5px] text-faint">Ctrl K</span>}
            </>
          )}
        </button>

        <NavButton
          icon={FolderClosed}
          label={`Projects${projects.length ? ` · ${projects.length}` : ""}`}
          active={view.name === "projects"}
          onClick={() => setView({ name: "projects", projectId: null })}
        />
        <NavButton
          icon={Settings2}
          label="设置"
          active={view.name === "settings"}
          onClick={() => setView({ name: "settings", section: "general" })}
        />
      </div>

      {!collapsed && (
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
          <GroupLabel>历史对话</GroupLabel>

          {pinned.length > 0 && (
            <>
              <GroupLabel>已置顶</GroupLabel>
              {pinned.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  collapsed={collapsed}
                  onMenu={openMenu}
                  renaming={renamingId === conv.id}
                  setRenaming={setRenamingId}
                />
              ))}
            </>
          )}

          {groups.map((group) => (
            <div key={group.label}>
              <GroupLabel>{group.label}</GroupLabel>
              {group.items.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  collapsed={collapsed}
                  onMenu={openMenu}
                  renaming={renamingId === conv.id}
                  setRenaming={setRenamingId}
                />
              ))}
            </div>
          ))}

          {visible.length === 0 && (
            <p className="px-2.5 py-2 text-[12px] leading-5 text-faint">
              还没有对话记录。点击「新建对话」开始。
            </p>
          )}

          {archived.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setArchivedOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-faint hover:bg-hover hover:text-muted"
              >
                <Archive size={12} />
                已归档 · {archived.length}
                <ChevronDown
                  size={12}
                  className={clsx("ml-auto transition-transform", archivedOpen && "rotate-180")}
                />
              </button>
              {archivedOpen &&
                archived.map((conv) => (
                  <div key={conv.id} className="opacity-75">
                    <ConversationRow
                      conv={conv}
                      active={conv.id === activeId}
                      collapsed={collapsed}
                      onMenu={openMenu}
                      renaming={renamingId === conv.id}
                      setRenaming={setRenamingId}
                    />
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {collapsed && (
        <div className="flex flex-1 items-end justify-center pb-3">
          <IconButton label="展开侧边栏" onClick={toggleCollapsed}>
            <PanelLeftOpen size={16} />
          </IconButton>
        </div>
      )}

      {menu && (
        <FloatingMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.conv)}
          onClose={() => setMenu(null)}
        />
      )}

      <Modal
        open={!!movingConv}
        onClose={() => setMovingConv(null)}
        title="移动到项目"
        description="将对话整理到项目中，方便之后查找。"
        width={400}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMovingConv(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (movingConv) {
                  await moveToProject(movingConv.id, moveTarget || null);
                }
                setMovingConv(null);
              }}
            >
              移动
            </Button>
          </>
        }
      >
        <div className="space-y-1">
          <button
            onClick={() => setMoveTarget("")}
            className={clsx(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]",
              moveTarget === "" ? "bg-accent-soft text-accent" : "text-ink hover:bg-hover",
            )}
          >
            不关联项目
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setMoveTarget(p.id)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]",
                moveTarget === p.id ? "bg-accent-soft text-accent" : "text-ink hover:bg-hover",
              )}
            >
              <FolderClosed size={14} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="px-2.5 py-2 text-[12px] text-faint">
              还没有项目。先在左侧「Projects」中创建一个。
            </p>
          )}
        </div>
      </Modal>
    </aside>
  );
}
