// Dev-only GitHub REST mock for exercising Mind's GitHub tools.
import { createServer } from "node:http";

const PORT = 8321;
const TOKEN = "test-github-token";

const REPOS = [
  {
    id: 1,
    name: "mock-repo",
    full_name: "mock-owner/mock-repo",
    private: false,
    description: "A mock repository used by Mind integration tests.",
    language: "TypeScript",
    stargazers_count: 42,
    forks_count: 7,
    open_issues_count: 2,
    default_branch: "main",
    topics: ["mock", "testing"],
    html_url: "https://github.com/mock-owner/mock-repo",
    updated_at: "2026-11-17T10:00:00Z",
  },
  {
    id: 2,
    name: "another",
    full_name: "mock-owner/another",
    private: true,
    description: "Another mock repository.",
    language: "Rust",
    stargazers_count: 3,
    forks_count: 0,
    open_issues_count: 0,
    default_branch: "main",
    topics: [],
    html_url: "https://github.com/mock-owner/another",
    updated_at: "2026-11-16T09:00:00Z",
  },
];

const ISSUES = [
  {
    number: 12,
    title: "Improve onboarding",
    state: "open",
    user: { login: "alice" },
    labels: [{ name: "enhancement" }, { name: "ui" }],
    comments: 3,
    created_at: "2026-11-15T08:00:00Z",
    html_url: "https://github.com/mock-owner/mock-repo/issues/12",
  },
  {
    number: 11,
    title: "A pull request that should be filtered out",
    state: "open",
    user: { login: "bob" },
    labels: [],
    comments: 0,
    created_at: "2026-11-14T08:00:00Z",
    html_url: "https://github.com/mock-owner/mock-repo/pull/11",
    pull_request: { url: "https://api.github.com/repos/mock-owner/mock-repo/pulls/11" },
  },
];

const PULLS = [
  {
    number: 11,
    title: "Add visual charts",
    state: "open",
    draft: false,
    user: { login: "bob" },
    updated_at: "2026-11-14T08:00:00Z",
    html_url: "https://github.com/mock-owner/mock-repo/pull/11",
  },
];

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  console.log(`[mock-github] ${req.method} ${url.pathname}${url.search}`);

  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    send(res, 401, { message: "Bad credentials" });
    return;
  }
  if (req.method !== "GET") {
    send(res, 405, { message: "Method not allowed in mock" });
    return;
  }

  if (url.pathname === "/user") {
    send(res, 200, {
      login: "mock-user",
      name: "Mock User",
      avatar_url: "https://github.com/identicons/mock-user.png",
    });
    return;
  }
  if (url.pathname === "/user/repos") {
    send(res, 200, REPOS);
    return;
  }
  if (url.pathname === "/search/repositories") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const items = REPOS.filter(
      (repo) =>
        repo.name.toLowerCase().includes(q) ||
        String(repo.description).toLowerCase().includes(q) ||
        q.includes("mock"),
    );
    send(res, 200, { total_count: items.length, items });
    return;
  }
  if (url.pathname === "/repos/mock-owner/mock-repo") {
    send(res, 200, REPOS[0]);
    return;
  }
  if (url.pathname === "/repos/mock-owner/mock-repo/issues") {
    send(res, 200, ISSUES);
    return;
  }
  if (url.pathname === "/repos/mock-owner/mock-repo/pulls") {
    send(res, 200, PULLS);
    return;
  }
  if (url.pathname === "/repos/mock-owner/mock-repo/contents/README.md") {
    const content = Buffer.from(
      "# Mock Repo\n\nHello from the GitHub mock.\n\n- item one\n- item two\n",
    ).toString("base64");
    send(res, 200, {
      type: "file",
      name: "README.md",
      path: "README.md",
      encoding: "base64",
      size: 64,
      content,
    });
    return;
  }
  if (url.pathname === "/repos/mock-owner/mock-repo/contents/") {
    send(res, 200, [
      { name: "README.md", path: "README.md", type: "file", size: 64 },
      { name: "src", path: "src", type: "dir", size: 0 },
    ]);
    return;
  }

  send(res, 404, { message: "Not Found" });
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`[mock-github] listening on http://127.0.0.1:${PORT}`),
);
