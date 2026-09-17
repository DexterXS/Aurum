import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");
const port = Number.parseInt(process.env.PORT || "3000", 10);
const backendHost = process.env.AURUM_BACKEND_HOST || "aurum-backend.railway.internal";
const backendPort = Number.parseInt(process.env.AURUM_BACKEND_PORT || "8000", 10);
const authUser = process.env.AURUM_BASIC_AUTH_USER || "";
const authPassword = process.env.AURUM_BASIC_AUTH_PASSWORD || "";
const allowedHostsRaw = process.env.AURUM_ALLOWED_HOSTS || "localhost 127.0.0.1";
const allowedHosts = new Set(allowedHostsRaw.split(/[\s,]+/).filter(Boolean));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function hostAllowed(req) {
  if (allowedHosts.has("*")) return true;
  const raw = req.headers.host || "";
  const hostname = raw.startsWith("[")
    ? raw.slice(1, raw.indexOf("]"))
    : raw.split(":", 1)[0];
  return allowedHosts.has(hostname);
}

function expectedAuthorization() {
  if (!authUser || !authPassword) return null;
  return `Basic ${Buffer.from(`${authUser}:${authPassword}`, "utf8").toString("base64")}`;
}

function authorized(req) {
  const expected = expectedAuthorization();
  if (expected === null) return true;
  const actual = req.headers.authorization || "";
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function rejectAuth(res) {
  // Intentionally no WWW-Authenticate header. Android Chrome can turn a Basic
  // challenge into a native browser dialog. Aurum has its own login screen,
  // so a plain 401 is enough for the React client to show "invalid login".
  res.writeHead(401, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify({ detail: "Invalid username or password" }));
}

function proxyApi(req, res) {
  const headers = { ...req.headers, host: `${backendHost}:${backendPort}` };
  delete headers.connection;

  const upstream = http.request(
    {
      hostname: backendHost,
      port: backendPort,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers };
      delete responseHeaders.connection;
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstream.setTimeout(60_000, () => upstream.destroy(new Error("backend timeout")));
  upstream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    console.error("[aurum-web] backend proxy error:", error.message);
    res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ detail: "Aurum backend is unavailable" }));
  });
  req.pipe(upstream);
}

function safeStaticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const candidate = path.resolve(distDir, `.${decoded}`);
  if (candidate !== distDir && !candidate.startsWith(`${distDir}${path.sep}`)) return null;
  return candidate;
}

function sendFile(req, res, filePath) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      const indexPath = path.join(distDir, "index.html");
      fs.stat(indexPath, (indexError, indexStat) => {
        if (indexError || !indexStat.isFile()) {
          res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
          res.end("Aurum frontend has not been built");
          return;
        }
        streamFile(req, res, indexPath);
      });
      return;
    }
    streamFile(req, res, filePath);
  });
}

function streamFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
  };
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  } else {
    headers["cache-control"] = "no-cache";
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  if (!hostAllowed(req)) {
    res.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
    res.end("Aurum: unexpected Host header");
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname.startsWith("/api/")) {
    if (url.pathname !== "/api/health" && !authorized(req)) {
      rejectAuth(res);
      return;
    }
    proxyApi(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  const filePath = safeStaticPath(url.pathname === "/" ? "/index.html" : url.pathname);
  if (!filePath) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad path");
    return;
  }
  sendFile(req, res, filePath);
});

server.on("clientError", (error, socket) => {
  console.warn("[aurum-web] client error:", error.message);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[aurum-web] listening on 0.0.0.0:${port}`);
  console.log(`[aurum-web] backend: http://${backendHost}:${backendPort}`);
  console.log(`[aurum-web] auth: ${authUser && authPassword ? `enabled for ${authUser}` : "DISABLED"}`);
});
