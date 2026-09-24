const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PORT = Number(process.env.IMPACT_BRIDGE_PORT || 8787);
const HOST = process.env.IMPACT_BRIDGE_HOST || "0.0.0.0";
const TOKEN_FILE = path.join(__dirname, ".bridge-token");
const TOKEN = process.env.IMPACT_BRIDGE_TOKEN || getSavedToken();
const PUBLIC_DIR = path.join(__dirname, "public");

let currentLead = null;
let updatedAt = null;
let commands = [];
const leadSubscribers = new Set();
const commandWaiters = new Set();

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
      for (const client of leadSubscribers) sendLeadEvent(client);
      sendJson(res, 200, { ok: true, updatedAt });
      return;
    }

    if (url.pathname === "/api/events" && req.method === "GET") {
      requireToken(req, url);
      sendCors(res, 200, { "content-type": "text/event-stream", connection: "keep-alive" });
      res.flushHeaders();
      leadSubscribers.add(res);
      sendLeadEvent(res);
      const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
      res.on("close", () => {
        clearInterval(heartbeat);
        leadSubscribers.delete(res);
      });
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

    if (url.pathname === "/api/command/result" && req.method === "POST") {
      requireToken(req, url);
      const body = await readJson(req);
      const result = { message: String(body.message || "Command completed.").slice(0, 300) };
      for (const client of leadSubscribers) client.write(`event: command-result\ndata: ${JSON.stringify(result)}\n\n`);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/command" && req.method === "POST") {
      requireToken(req, url);
      const body = await readJson(req);
      if (!["next", "previous", "call", "no-answer", "refused-appointment"].includes(body?.type)) {
        sendJson(res, 400, { ok: false, error: "Unsupported command." });
        return;
      }

      if (["no-answer", "refused-appointment"].includes(body.type) && (!body.leadId || body.leadId !== currentLead?.leadId)) {
        sendJson(res, 400, { ok: false, error: "The lead changed. Refresh the phone before choosing a call result." });
        return;
      }

      if (body.type === "call" && (!body.leadId || body.leadId !== currentLead?.leadId ||
          !["Mobile", "Home"].includes(body.phoneType) || typeof body.phoneNumber !== "string")) {
        sendJson(res, 400, { ok: false, error: "Refresh the lead before calling; a matching Home or Mobile number is required." });
        return;
      }

      const command = {
        id: crypto.randomUUID(),
        type: body.type,
        requestedAt: new Date().toISOString()
      };
      if (body.type === "call") {
        command.leadId = body.leadId;
        command.phoneType = body.phoneType;
        command.phoneNumber = body.phoneNumber;
      }
      if (["no-answer", "refused-appointment"].includes(body.type)) command.leadId = body.leadId;
      commands.push(command);
      commands = commands.slice(-20);
      const waiting = commandWaiters.values().next().value;
      if (waiting) waiting(commands.shift());
      sendJson(res, 200, { ok: true, command });
      return;
    }

    if (url.pathname === "/api/command/next" && req.method === "GET") {
      requireToken(req, url);
      if (!commands.length && url.searchParams.get("wait") === "1") {
        let timer;
        const deliver = (command) => {
          clearTimeout(timer);
          commandWaiters.delete(deliver);
          if (!res.destroyed) sendJson(res, 200, { ok: true, command });
        };
        commandWaiters.add(deliver);
        timer = setTimeout(() => deliver(null), 5000);
        res.on("close", () => {
          clearTimeout(timer);
          commandWaiters.delete(deliver);
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        command: commands.shift() || null
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
    console.log(`  http://${address}:${PORT}/`);
  }
});

function getSavedToken() {
  try {
    const saved = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved) return saved;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const token = crypto.randomBytes(18).toString("hex");
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

function sendLeadEvent(res) {
  res.write(`data: ${JSON.stringify({ ok: true, lead: currentLead, updatedAt })}\n\n`);
}

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

    if (pathname === "/index.html") {
      // Opening the local page pairs the phone automatically. Do not expose
      // the pairing page to cross-origin JavaScript through CORS.
      content = content.toString().replace("<head>", `<head><meta name="impact-bridge-token" content="${encodeURIComponent(TOKEN)}">`);
    }
    res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
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
