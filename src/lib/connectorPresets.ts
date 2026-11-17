import type { RuntimeInfo } from "../types";

export interface ConnectorPreset {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  requires: "node" | "uv";
  recommended?: boolean;
}

export const CONNECTOR_PRESETS: ConnectorPreset[] = [
  {
    id: "fetch",
    name: "网页抓取",
    description: "抓取网页正文并转成 Markdown，适合读文章、文档和资料。",
    command: "uvx",
    args: ["mcp-server-fetch"],
    requires: "uv",
    recommended: true,
  },
  {
    id: "time",
    name: "时间与日期",
    description: "提供当前时间、时区和时间换算，适合日程与提醒。",
    command: "uvx",
    args: ["mcp-server-time"],
    requires: "uv",
  },
  {
    id: "memory",
    name: "结构化记忆",
    description: "用 MCP 记忆库存放可检索的长期事实，适合跨对话资料。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    requires: "node",
    recommended: true,
  },
  {
    id: "filesystem",
    name: "文件与文件夹",
    description: "读取你指定目录中的文件。添加时请把最后的路径改成真实文件夹。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "D:\\Documents"],
    requires: "node",
  },
];

export function runtimeAvailable(
  preset: ConnectorPreset,
  runtime: RuntimeInfo | null,
): boolean {
  if (!runtime) return false;
  return preset.requires === "node" ? runtime.npx : runtime.uvx;
}

export function runtimeLabel(runtime: RuntimeInfo | null): string {
  if (!runtime) return "正在检测 Node.js / uv…";
  const parts: string[] = [];
  if (runtime.node) parts.push(`Node ${runtime.nodeVersion ?? "已安装"}`);
  if (runtime.uvx) parts.push(`uvx ${runtime.uvxVersion ?? "已安装"}`);
  return parts.length ? parts.join(" · ") : "未检测到 Node.js 或 uv";
}
