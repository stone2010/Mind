// Dev-only MCP server over stdio for testing Mind connectors.
import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "echo",
    description: "原样返回输入的文字，用于验证工具调用。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "要返回的文字" },
      },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "计算两个数字的和。",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "第一个数字" },
        b: { type: "number", description: "第二个数字" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "crash",
    description: "测试用：立即退出进程，验证崩溃恢复。",
    inputSchema: { type: "object", properties: {} },
  },
];

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function handle(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;
  if (method === undefined) return; // response from client; nothing to do

  if (id === undefined || id === null) {
    // notification: notifications/initialized and friends need no reply
    return;
  }

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mind-mock-mcp", version: "0.1.0" },
        },
      });
      return;
    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name === "echo") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Echo: ${String(args.text ?? "")}` }],
            isError: false,
          },
        });
        return;
      }
      if (name === "add") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `${Number(args.a ?? 0) + Number(args.b ?? 0)}` }],
            isError: false,
          },
        });
        return;
      }
      if (name === "crash") {
        process.exit(1);
      }
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        },
      });
      return;
    }
    default:
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handle(JSON.parse(trimmed));
  } catch {
    // Ignore non-JSON output from the child process itself.
  }
});
