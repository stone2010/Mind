// Dev-only: a tiny OpenAI-compatible SSE server for exercising the real
// streaming path without calling an external provider.
import { createServer } from "node:http";

const PORT = 8317;

const REASONING = [
  "用户在测试本地 OpenAI Compatible 服务。",
  "我需要确认流式文本、代码块和数学公式都能正常渲染。",
  "然后给出简洁的结论。",
];

const CONTENT = [
  "根据联网搜索到的资料，这是来自**本地测试服务**的流式回复。\n\n",
  "它验证了以下能力：\n\n",
  "- 通过 SSE 逐段接收内容\n",
  "- 搜索来源与正文分开返回\n",
  "- 代码块与公式正常渲染\n\n",
  "```js\n",
  'console.log("streaming works");\n',
  "```\n\n",
  "行内公式：$a^2 + b^2 = c^2$\n",
];

const SEARCH_QUERIES = ["DeepSeek V4.1 更新", "DeepSeek 联网搜索"];

const SOURCES = [
  {
    type: "url",
    url: "https://example.com/deepseek-v41",
    title: "DeepSeek V4.1 更新说明",
    snippet: "DeepSeek 发布 V4.1 Flash，支持更快的联网搜索与更长的上下文。",
    site_name: "Example News",
    published_at: "2026-10-17",
  },
  {
    type: "url",
    url: "https://example.org/benchmarks",
    title: "Independent model benchmarks",
    snippet: "An independent benchmark comparison of current DeepSeek models.",
    site_name: "Example Org",
    published_at: "2026-10-18",
  },
];

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
    res.writeHead(404).end("not found");
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    const lastUser = Array.isArray(parsed.messages) ? parsed.messages[parsed.messages.length - 1] : null;
    const tools = Array.isArray(parsed.tools) ? parsed.tools.map((t) => t.type) : [];
    const assistants = Array.isArray(parsed.messages)
      ? parsed.messages.filter((m) => m.role === "assistant")
      : [];
    const isMemoryCall = (parsed.messages || []).some(
      (m) => m.role === "system" && String(m.content).includes("记忆提取"),
    );
    const memoryInjected = (parsed.messages || []).some(
      (m) =>
        m.role === "system" &&
        String(m.content).includes("以下是关于用户的长期记忆"),
    );
    const toolResults = Array.isArray(parsed.messages)
      ? parsed.messages.filter((m) => m.role === "tool")
      : [];
    console.log(
      `[mock] auth=${req.headers.authorization ? "present" : "MISSING"} model=${parsed.model} stream=${parsed.stream} memory=${isMemoryCall} memoryInjected=${memoryInjected} messages=${parsed.messages?.length} tools=${tools.join(",") || "none"} toolHistory=${assistants.filter((m) => m.server_tool_calls).length} reasoningHistory=${assistants.filter((m) => m.reasoning_content).length} toolResults=${toolResults.length} file=${String(lastUser?.content).includes("<file name=")}`,
    );
    if (lastUser) console.log("[mock] last message:", JSON.stringify(lastUser).slice(0, 260));
    if (toolResults.length) {
      console.log("[mock] tool result:", JSON.stringify(toolResults[toolResults.length - 1]).slice(0, 300));
    }

    const withSearch = tools.includes("deepseek_web_search");
    const functionTools = (parsed.tools || []).filter((t) => t.type === "function");
    const lastMessage = Array.isArray(parsed.messages)
      ? parsed.messages[parsed.messages.length - 1]
      : null;

    if (!req.headers.authorization?.startsWith("Bearer ")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "missing bearer token" } }));
      return;
    }

    const systemText = Array.isArray(parsed.messages)
      ? parsed.messages.find((m) => m.role === "system")?.content || ""
      : "";
    const isMemoryExtraction = systemText.includes("记忆提取");
    const isCompression = systemText.includes("对话压缩器");
    if (isCompression) console.log("[mock] context compression call");

    if (!parsed.stream) {
      const content = isMemoryExtraction
        ? JSON.stringify({
            memories: [
              {
                type: "preference",
                subject: "response_style",
                content: "用户偏好简洁、直接的中文回答。",
                confidence: 0.95,
                importance: 0.9,
              },
              {
                type: "project",
                subject: "project_mind",
                content: "用户正在开发一款名为 Mind 的 Windows 桌面 AI 客户端。",
                confidence: 0.9,
                importance: 0.95,
              },
              {
                type: "preference",
                subject: "preferred_model",
                content: "用户希望默认使用 DeepSeek Flash。",
                confidence: 0.85,
                importance: 0.7,
              },
            ],
          })
        : isCompression
          ? "用户此前进行了多轮长对话，主要目标是验证 Mind 的上下文压缩、工具调用和用量统计。已确认旧消息会被摘要替代，最近的用户目标和未完成事项要继续保留。"
          : "pong";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: isCompression ? 3210 : 8,
            completion_tokens: isCompression ? 96 : 2,
            total_tokens: isCompression ? 3306 : 10,
          },
        }),
      );
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    sse(res, { choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });

    const toolCall = {
      index: 0,
      id: "srvtoolu_mock_1",
      type: "deepseek_web_search",
      kind: "search",
      action: { type: "search", queries: SEARCH_QUERIES },
      status: "running",
    };

    if (functionTools.length > 0 && lastMessage?.role === "user") {
      const userText = String(lastMessage.content || "").toLowerCase();
      const githubName = userText.includes("readme")
        ? "github__read_file"
        : userText.includes("issue")
          ? "github__list_issues"
          : userText.includes("pull")
            ? "github__list_pull_requests"
            : userText.includes("search")
              ? "github__search_repositories"
              : "github__get_repository";
      const githubTool = functionTools.find(
        (t) => String(t.function?.name) === githubName,
      );
      const preferred =
        functionTools.find((t) => String(t.function?.name).endsWith("__echo")) ||
        githubTool ||
        functionTools[0];
      const name = preferred.function?.name;
      const properties = preferred.function?.parameters?.properties || {};
      const args = {};
      if (name?.includes("github__")) {
        args.owner = "mock-owner";
        args.repo = "mock-repo";
        if (name.endsWith("read_file")) args.path = "README.md";
        if (name.endsWith("search_repositories")) args.query = "mock";
      } else if (properties.text) {
        args.text = "Hello from Mind connector test";
      }
      if (properties.a !== undefined) args.a = 3;
      if (properties.b !== undefined) args.b = 5;
      console.log(`[mock] requesting function call: ${name} args=${JSON.stringify(args)}`);
      await wait(90);
      sse(res, {
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  index: 0,
                  id: "call_mock_1",
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      await wait(90);
      sse(res, {
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 24, completion_tokens: 12, total_tokens: 36 },
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (withSearch) {
      await wait(120);
      sse(res, {
        choices: [
          {
            index: 0,
            delta: {},
            server_tool_event: { type: "call_started", step: 0, call: toolCall },
          },
        ],
      });
      await wait(180);
      sse(res, {
        choices: [
          {
            index: 0,
            delta: {},
            server_tool_event: {
              type: "call_completed",
              step: 0,
              call: { ...toolCall, status: "completed", sources: SOURCES },
            },
          },
        ],
      });
    }

    if (lastMessage?.role === "tool") {
      const result = String(toolResults[toolResults.length - 1].content || "");
      const denied = result.includes("用户拒绝");
      const reply = denied
        ? "已按你的要求取消工具调用。需要的话可以换一种方式继续。\n"
        : `连接器返回：${result}\n\n以上内容来自本机 MCP 模拟服务，用于验证工具调用链路。\n`;
      for (const part of reply.match(/[\s\S]{1,24}/g) || []) {
        await wait(35);
        sse(res, { choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
      }
      await wait(60);
      sse(res, {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    for (const part of REASONING) {
      await wait(80);
      sse(res, { choices: [{ index: 0, delta: { reasoning_content: part }, finish_reason: null }] });
    }
    const asksClarification = String(lastMessage?.content || "").includes("帮我选");
    const asksTextQuestion = String(lastMessage?.content || "").includes("问我一个问题");
    const asksVisual = String(lastMessage?.content || "").includes("画图");
    const contentParts = asksClarification
      ? [
          "为了给你更合适的方案，我需要确认一点：\n\n",
          "```ask\n",
          "Q1 你希望优先做什么？\n",
          "- A. 快速原型（推荐）\n",
          "- B. 长期维护\n",
          "```\n",
        ]
      : asksTextQuestion
        ? [
            "为了给你更准确的回答，我需要确认：\n\n",
            "```ask\n",
            "Q1 你的目标平台是什么？\n",
            "```\n",
          ]
        : asksVisual
          ? [
              "下面是可视化结果：\n\n",
              '```chart\n{"type":"bar","title":"月度销量","subtitle":"按渠道拆分","unit":"万元","labels":["1月","2月","3月","4月"],"series":[{"name":"线上","values":[42,58,65,81]},{"name":"线下","values":[30,36,41,45]}]}\n```\n\n',
              '```chart\n{"type":"pie","title":"渠道占比","unit":"%","labels":["直销","代理","线上"],"series":[{"name":"占比","values":[45,30,25]}]}\n```\n\n',
              "```mermaid\ngraph TD\n  A[用户问题] --> B{需要记忆?}\n  B -->|是| C[检索记忆]\n  B -->|否| D[直接回答]\n```\n",
            ]
          : CONTENT;
    for (const part of contentParts) {
      await wait(70);
      sse(res, { choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
    }
    await wait(80);

    const finalDelta = {};
    if (withSearch) {
      finalDelta.server_tool_calls = [
        {
          index: 0,
          reasoning_content: "",
          calls: [{ ...toolCall, status: "completed", sources: SOURCES }],
        },
      ];
      finalDelta.annotations = [
        {
          type: "url_citation",
          url_citation: {
            url: SOURCES[0].url,
            title: SOURCES[0].title,
            start_index: 0,
            end_index: 12,
          },
        },
      ];
    }
    sse(res, {
      choices: [{ index: 0, delta: finalDelta, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 18,
        completion_tokens: 42,
        total_tokens: 60,
        prompt_cache_hit_tokens: 10,
        prompt_cache_miss_tokens: 8,
        server_tool_use: { tool_search: withSearch ? 1 : 0 },
      },
    });
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock] listening on http://127.0.0.1:${PORT}`));
