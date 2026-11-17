// Dev-only helper: drive the running WebView2 window over the DevTools protocol.
// Usage: node scripts/cdp.mjs eval "<js>"
//        node scripts/cdp.mjs shot <out.png>
//        node scripts/cdp.mjs info
import { writeFileSync } from "node:fs";

const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = pages.find((p) => p.type === "page");
if (!page) {
  console.error("no page");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const [cmd, arg] = process.argv.slice(2);
await send("Runtime.enable");
await send("Page.enable");

if (cmd === "eval") {
  const res = await send("Runtime.evaluate", {
    expression: arg,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  console.log(JSON.stringify(res.result ?? res, null, 2));
} else if (cmd === "shot") {
  const res = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(arg, Buffer.from(res.result.data, "base64"));
  console.log("saved", arg);
} else if (cmd === "call") {
  const params = process.argv[4] ? JSON.parse(process.argv[4]) : {};
  const res = await send(arg, params);
  console.log(JSON.stringify(res));
} else if (cmd === "info") {
  const res = await send("Runtime.evaluate", {
    expression:
      "JSON.stringify({href: location.href, title: document.title, body: document.body ? document.body.innerText.slice(0, 800) : null, html: document.documentElement ? document.documentElement.outerHTML.length : 0})",
    returnByValue: true,
  });
  console.log(res.result?.result?.value);
} else {
  console.error("unknown command");
}
ws.close();
