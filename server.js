import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 8765;
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");
const HTML_FILE = path.join(__dirname, "index.html");
const TREE_FILE = path.join(__dirname, "index-tree.html");
const TREEMAP_FILE = path.join(__dirname, "index-treemap.html");
const RADIAL_FILE = path.join(__dirname, "index-radial.html");
const HORIZON_FILE = path.join(__dirname, "index-horizon.html");
const MONITOR_TREE_JS = path.join(__dirname, "monitor-tree.js");
const MONITOR_HIGHLIGHTS_JS = path.join(__dirname, "monitor-highlights.js");
const MONITOR_ZOOM_JS = path.join(__dirname, "monitor-zoom.js");
const MONITOR_PREVIEW_JS = path.join(__dirname, "monitor-preview.js");
const MONITOR_BADGES_JS = path.join(__dirname, "monitor-badges.js");
const MONITOR_LEGEND_JS = path.join(__dirname, "monitor-legend.js");
const MONITOR_CHROME_CSS = path.join(__dirname, "monitor-chrome.css");
const SETTINGS_FILE = path.join(__dirname, "monitor-settings.json");

const DEFAULT_SETTINGS = {
  horizonTimelineScale: 1,
};

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(partial) {
  const next = { ...readSettings(), ...partial };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

let monitorSettings = readSettings();

const ROUTES = {
  "/": DASHBOARD_FILE,
  "/explorer": HTML_FILE,
  "/tree": TREE_FILE,
  "/treemap": TREEMAP_FILE,
  "/radial": RADIAL_FILE,
  "/horizon": HORIZON_FILE,
  "/monitor-tree.js": MONITOR_TREE_JS,
  "/monitor-highlights.js": MONITOR_HIGHLIGHTS_JS,
  "/monitor-zoom.js": MONITOR_ZOOM_JS,
  "/monitor-preview.js": MONITOR_PREVIEW_JS,
  "/monitor-badges.js": MONITOR_BADGES_JS,
  "/monitor-legend.js": MONITOR_LEGEND_JS,
  "/monitor-chrome.css": MONITOR_CHROME_CSS,
};

const MAX_ACTIVITY_EVENTS = 800;
const MAX_ACTIVITY_AGE_MS = 10 * 60 * 1000;

const clients = new Set();

/** Replay to new browser tabs after refresh. */
const stateCache = {
  projectIndex: null,
  sessionReset: null,
  lastUpdate: null,
  agentStatus: null,
  fileProgress: null,
  activityEvents: [],
};

function updateStateCache(data) {
  if (!data?.type) return;
  if (data.type === "monitor_settings") {
    const patch = {};
    if (typeof data.horizonTimelineScale === "number") {
      patch.horizonTimelineScale = data.horizonTimelineScale;
    }
    if (Object.keys(patch).length) {
      try {
        monitorSettings = writeSettings(patch);
      } catch (err) {
        console.warn("[monitor] settings write failed:", err?.message || err);
      }
    }
    return;
  }
  if (data.type === "project_index") stateCache.projectIndex = data;
  if (data.type === "session_reset") {
    stateCache.sessionReset = data;
    stateCache.lastUpdate = null;
    stateCache.fileProgress = null;
    stateCache.activityEvents = [];
    stateCache.resetSeq = data.resetSeq ?? stateCache.resetSeq;
  }
  if (data.type === "activity_event") {
    stateCache.activityEvents.push(data);
    const cutoff = Date.now() - MAX_ACTIVITY_AGE_MS;
    stateCache.activityEvents = stateCache.activityEvents
      .filter((e) => e.at >= cutoff)
      .slice(-MAX_ACTIVITY_EVENTS);
  }
  if (data.type === "update" && data.resetSeq != null) {
    if (
      stateCache.resetSeq != null &&
      data.resetSeq < stateCache.resetSeq
    ) {
      return;
    }
  }
  if (data.type === "update" && data.tree) stateCache.lastUpdate = data;
  if (data.type === "agent_status") stateCache.agentStatus = data;
  if (data.type === "file_progress") stateCache.fileProgress = data;
}

function replayState(ws) {
  // activity_batch before agent_status so horizon is not frozen before events replay
  const replay = [
    stateCache.projectIndex,
    stateCache.sessionReset,
    stateCache.lastUpdate,
    stateCache.fileProgress,
  ].filter(Boolean);
  for (const msg of replay) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
  if (stateCache.activityEvents.length && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "activity_batch",
        events: stateCache.activityEvents,
      })
    );
  }
  if (stateCache.agentStatus && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(stateCache.agentStatus));
  }
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "monitor_settings", ...monitorSettings }));
  }
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (url.pathname === "/api/settings") {
      if (req.method === "GET") {
        monitorSettings = readSettings();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(monitorSettings));
        return;
      }
      if (req.method === "PUT" || req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const patch = body ? JSON.parse(body) : {};
            if (
              patch.horizonTimelineScale != null &&
              (typeof patch.horizonTimelineScale !== "number" ||
                patch.horizonTimelineScale < 0.1 ||
                patch.horizonTimelineScale > 8)
            ) {
              res.writeHead(400);
              res.end("horizonTimelineScale must be a number between 0.1 and 8");
              return;
            }
            monitorSettings = writeSettings(patch);
            const msg = JSON.stringify({
              type: "monitor_settings",
              ...monitorSettings,
            });
            clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) client.send(msg);
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(monitorSettings));
          } catch {
            res.writeHead(400);
            res.end("Invalid JSON");
          }
        });
        return;
      }
      res.writeHead(405);
      res.end();
      return;
    }

    if (url.pathname === "/preview") {
      const relPath = url.searchParams.get("path") || "";
      const projectRoot =
        stateCache.projectIndex?.projectRoot ||
        stateCache.sessionReset?.projectRoot;
      if (!projectRoot || !relPath) {
        res.writeHead(400);
        res.end("Missing project root or path");
        return;
      }
      const abs = path.resolve(projectRoot, relPath);
      if (!abs.startsWith(path.resolve(projectRoot))) {
        res.writeHead(400);
        res.end("Invalid path");
        return;
      }
      fs.readFile(abs, "utf8", (err, text) => {
        if (err) {
          res.writeHead(404);
          res.end("File not found");
          return;
        }
        const max = 8000;
        const body = text.length > max ? text.slice(0, max) : text;
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(body);
      });
      return;
    }

    const file = ROUTES[url.pathname];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    const isJs = url.pathname.endsWith(".js");
    const isCss = url.pathname.endsWith(".css");
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("HTML not found");
      } else {
        const contentType = isJs
          ? "application/javascript"
          : isCss
            ? "text/css"
            : "text/html";
        res.writeHead(200, {
          "Content-Type": contentType,
        });
        res.end(data);
      }
    });
  } catch {
    res.writeHead(500);
    res.end("Server error");
  }
});

const wss = new WebSocketServer({ server });

function relayToOthers(sender, rawMessage) {
  try {
    updateStateCache(JSON.parse(rawMessage));
  } catch {
    // non-JSON
  }
  clients.forEach((client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(rawMessage);
    }
  });
}

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("✅ Monitor client connected");
  replayState(ws);

  ws.on("message", (raw) => {
    relayToOthers(ws, raw.toString());
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log("❌ Monitor client disconnected");
  });
});

export function broadcast(data) {
  const message = JSON.stringify(data);
  updateStateCache(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

server.listen(PORT, () => {
  console.log(`🚀 Agent Monitor server running at http://localhost:${PORT}`);
  console.log(`  Dashboard:    http://localhost:${PORT}/`);
  console.log(`  Activity tab:   http://localhost:${PORT}/explorer`);
  console.log(`  Tree tab:     http://localhost:${PORT}/tree`);
  console.log(`  Treemap tab:  http://localhost:${PORT}/treemap`);
  console.log(`  Radial tab:   http://localhost:${PORT}/radial`);
  console.log(`  Horizon tab:  http://localhost:${PORT}/horizon`);
});
