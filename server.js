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

const ROUTES = {
  "/": DASHBOARD_FILE,
  "/explorer": HTML_FILE,
  "/tree": TREE_FILE,
  "/treemap": TREEMAP_FILE,
  "/radial": RADIAL_FILE,
  "/horizon": HORIZON_FILE,
  "/monitor-tree.js": MONITOR_TREE_JS,
  "/monitor-highlights.js": MONITOR_HIGHLIGHTS_JS,
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
  const replay = [
    stateCache.projectIndex,
    stateCache.sessionReset,
    stateCache.lastUpdate,
    stateCache.agentStatus,
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
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
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
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("HTML not found");
      } else {
        res.writeHead(200, {
          "Content-Type": isJs ? "application/javascript" : "text/html",
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
  console.log(`  Explorer tab: http://localhost:${PORT}/explorer`);
  console.log(`  Tree tab:     http://localhost:${PORT}/tree`);
  console.log(`  Treemap tab:  http://localhost:${PORT}/treemap`);
  console.log(`  Radial tab:   http://localhost:${PORT}/radial`);
  console.log(`  Horizon tab:  http://localhost:${PORT}/horizon`);
});
