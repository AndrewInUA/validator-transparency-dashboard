/**
 * Local preview with a real /api/my-stake (loads .env / .env.local).
 *   node scripts/local-preview.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT || 4173);

function loadEnvFile(name) {
  const p = join(root, name);
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const { default: myStake } = await import(
  pathToFileURL(join(root, "api/my-stake.js")).href
);
const { default: networkStats } = await import(
  pathToFileURL(join(root, "api/network-stats.js")).href
);

const PROD_API = "https://validator-transparency-dashboard.vercel.app";

async function proxyApi(req, res, url) {
  const dest = `${PROD_API}${url.pathname}${url.search}`;
  try {
    const up = await fetch(dest, { headers: { accept: "application/json" } });
    const body = Buffer.from(await up.arrayBuffer());
    res.statusCode = up.status;
    res.setHeader("Content-Type", up.headers.get("content-type") || "application/json");
    res.end(body);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: err.message || "Proxy failed" }));
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json"
};

function vercelRes(res) {
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = obj => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
  };
  return res;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
  res.end(readFileSync(file));
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/api/my-stake" || url.pathname === "/api/network-stats") {
    req.query = Object.fromEntries(url.searchParams);
    vercelRes(res);
    const handler = url.pathname === "/api/my-stake" ? myStake : networkStats;
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: err.message || "Server error" }));
      }
    }
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    await proxyApi(req, res, url);
    return;
  }
  serveStatic(req, res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`My stake local: http://127.0.0.1:${PORT}/mystake.html`);
});
