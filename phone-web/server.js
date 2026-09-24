const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PORT = Number(process.env.IMPACT_BRIDGE_PORT || 8787);
const HOST = process.env.IMPACT_BRIDGE_HOST || "0.0.0.0";
const TOKEN = process.env.IMPACT_BRIDGE_TOKEN || crypto.randomBytes(18).toString("hex");
const PUBLIC_DIR = path.join(__dirname, "public");

let currentLead = null;
let updatedAt = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      sendCors(res, 204);
      return;
    }

    if (url.pathname === "/api/current-lead" && req.method === "POST") {
      requireToken(req, url);
      const body = await readJson(req);
      if (!body?.lead?.available) {
        sendJson(res, 400, { ok: false, error: "Lead payload missing." });
        return;
      }

      currentLead = body.lead;
      updatedAt = new Date().toISOString();
      sendJson(res, 200, { ok: true, updatedAt });
      return;
    }

    if (url.pathname === "/api/current-lead" && req.method === "GET") {
      requireToken(req, url);
      sendJson(res, 200, {
        ok: true,
        lead: currentLead,
        updatedAt
      });
      return;
    }

    if (req.method === "GET") {
      serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || "Server error."
    });
  }
});

server.listen(PORT, HOST, () => {
  const localBridge = `http://127.0.0.1:${PORT}`;
  console.log("IMPACT phone bridge running.");
  console.log(`Bridge URL for extension Options: ${localBridge}`);
  console.log(`Bridge token for extension Options: ${TOKEN}`);
  console.log("Phone URLs on this Wi-Fi:");
  for (const address of getLanAddresses()) {
    console.log(`  http://${address}:${PORT}/?token=${TOKEN}`);
  }
});

function requireToken(req, url) {
  const headerToken = req.headers["x-bridge-token"];
  const queryToken = url.searchParams.get("token");
  if (headerToken !== TOKEN && queryToken !== TOKEN) {
    const error = new Error("Unauthorized bridge token.");
    error.statusCode = 401;
    throw error;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(requestPath, res) {
  const pathname = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { ok: false, error: "Forbidden." });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: "Not found." });
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8"
    }[ext] || "application/octet-stream";

    sendCors(res, 200, { "content-type": contentType });
    res.end(content);
  });
}

function sendJson(res, statusCode, payload) {
  sendCors(res, statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendCors(res, statusCode, headers = {}) {
  res.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-bridge-token",
    "cache-control": "no-store",
    ...headers
  });
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((network) => network && network.family === "IPv4" && !network.internal)
    .map((network) => network.address);
}

