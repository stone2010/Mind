import {
  ArrowLeft,
  FolderClosed,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/bridge";
import { useAppStore } from "../store/app";
import { useChatStore } from "../store/chat";
import { confirmDialog } from "../store/confirm";
import { pushToast } from "../store/toast";
import type { Project } from "../types";
import { FloatingMenu, type MenuItem } from "./Menu";
import { Button, Field, Input, Modal, Textarea } from "./ui";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  });
}

export function ProjectsView() {
  const view = useAppStore((s) => s.view);
  const projects = useAppStore((s) => s.projects);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setView = useAppStore((s) => s.setView);
  const conversations = useChatStore((s) => s.conversations);
  const newChat = useChatStore((s) => s.newChat);
  const openConversation = useChatStore((s) => s.openConversation);

  const projectId = view.name === "projects" ? view.projectId : null;
  const project = projects.find((p) => p.id === projectId) ?? null;
  const projectConversations = projectId
    ? conversations.filter((c) => c.projectId === projectId && !c.archived)
    : [];

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; project: Project } | null>(null);

  const openCreate = () => {
    setName("");
    setDescription("");
    setCreating(true);
  };

  const openEdit = (p: Project) => {
    setName(p.name);
    setDescription(p.description ?? "");
    setEditing(p);
  };

  const submitCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createProject(name.trim(), description.trim() || null);
      await refreshProjects();
      setCreating(false);
    } catch (err) {
      pushToast({ kind: "error", title: "创建失败", detail: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!editing || !name.trim()) return;
    setSaving(true);
    try {
      await api.updateProject(editing.id, name.trim(), description.trim() || null);
      await refreshProjects();
      setEditing(null);
    } catch (err) {
      pushToast({ kind: "error", title: "保存失败", detail: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const removeProject = async (p: Project) => {
    const ok = await confirmDialog({
      title: `删除项目「${p.name}」？`,
      body: "项目中的对话不会被删除，只会解除与项目的关联。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteProject(p.id);
      await refreshProjects();
      await useChatStore.getState().loadConversations();
      if (projectId === p.id) setView({ name: "projects", projectId: null });
    } catch (err) {
      pushToast({ kind: "error", title: "删除失败", detail: errorMessage(err) });
    }
  };

  const projectMenu = (p: Project): MenuItem[] => [
    {
      label: "重命名或编辑",
      icon: <Pencil size={13} />,
      onClick: () => openEdit(p),
    },
    {
      label: "删除项目",
      icon: <Trash2 size={13} />,
      danger: true,
      separator: true,
      onClick: () => void removeProject(p),
    },
  ];

  const openMenu = (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: rect.right - 188, y: rect.bottom + 4, project: p });
  };

  const startProjectChat = () => {
    newChat(project?.id ?? null);
    setView({ name: "chat" });
    requestAnimationFrame(() => document.getElementById("composer-input")?.focus());
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg">
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-6">
        {project ? (
          <>
            <button
              onClick={() => setView({ name: "projects", projectId: null })}
              className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink"
            >
              <ArrowLeft size={14} />
              Projects
            </button>
            <span className="text-faint">/</span>
            <h1 className="min-w-0 truncate text-[13.5px] font-medium text-ink">
              {project.name}
            </h1>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              icon={<Pencil size={13} />}
              onClick={() => openEdit(project)}
            >
              编辑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="hover:text-danger"
              icon={<Trash2 size={13} />}
              onClick={() => void removeProject(project)}
            >
              删除
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-[13.5px] font-medium text-ink">Projects</h1>
            <div className="flex-1" />
            <Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>
              新建项目
            </Button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-6 pb-10 pt-2">
          {!project ? (
            <>
              <p className="text-[12.5px] leading-5 text-muted">
                用项目把相关的对话整理在一起，例如某一项工作、一次学习计划。
              </p>

              {projects.length === 0 ? (
                <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-line py-16">
                  <FolderClosed size={26} className="text-faint" strokeWidth={1.4} />
                  <p className="mt-3 text-[13px] text-muted">还没有项目</p>
                  <p className="mt-1 text-[12px] text-faint">
                    创建项目后，可以把对话归档到项目里。
                  </p>
                  <Button size="sm" variant="primary" className="mt-4" onClick={openCreate}>
                    新建项目
                  </Button>
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setView({ name: "projects", projectId: p.id })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setView({ name: "projects", projectId: p.id });
                        }
                      }}
                      className="group cursor-pointer rounded-xl border border-line p-4 transition-colors hover:border-line-strong hover:bg-hover"
                    >
                      <div className="flex items-start gap-2">
                        <FolderClosed size={15} className="mt-0.5 shrink-0 text-accent" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                          {p.name}
                        </span>
                        <button
                          onClick={(e) => openMenu(e, p)}
                          className="rounded p-0.5 text-faint opacity-0 hover:bg-active hover:text-ink group-hover:opacity-100"
                          aria-label="项目操作"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                      <p className="mt-1.5 line-clamp-2 min-h-[20px] text-[12px] leading-5 text-muted">
                        {p.description || "暂无描述"}
                      </p>
                      <p className="mt-3 text-[11px] text-faint">
                        {p.conversationCount} 个对话
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <p className="max-w-[560px] text-[12.5px] leading-5 text-muted">
                  {project.description || "这个项目还没有描述。"}
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<MessageSquarePlus size={13} />}
                  onClick={startProjectChat}
                  className="shrink-0"
                >
                  在此项目中新建对话
                </Button>
              </div>

              {projectConversations.length === 0 ? (
                <div className="mt-5 rounded-xl border border-dashed border-line py-12 text-center">
                  <p className="text-[12.5px] text-muted">项目里还没有对话</p>
                  <p className="mt-1 text-[11.5px] text-faint">
                    新建一个对话，或在历史对话的菜单中「移动到项目」。
                  </p>
                  <Button size="sm" variant="ghost" className="mt-3" onClick={startProjectChat}>
                    开始第一个对话
                  </Button>
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-xl border border-line">
                  {projectConversations.map((c, i) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setView({ name: "chat" });
                        void openConversation(c.id);
                      }}
                      className={clsx(
                        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover",
                        i > 0 && "border-t border-line",
                      )}
                    >
                      <FolderClosed size={13} className="shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {c.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-faint">
                        {formatDate(c.updatedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {menu && (
        <FloatingMenu
          x={menu.x}
          y={menu.y}
          items={projectMenu(menu.project)}
          onClose={() => setMenu(null)}
        />
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="新建项目"
        description="项目用于整理相关的对话。"
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!name.trim()}
              onClick={submitCreate}
            >
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="项目名称">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：季度规划"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) void submitCreate();
              }}
            />
          </Field>
          <Field label="描述" hint="可选">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单说明这个项目用来做什么"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="编辑项目"
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!name.trim()}
              onClick={submitEdit}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="项目名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="描述" hint="可选">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
