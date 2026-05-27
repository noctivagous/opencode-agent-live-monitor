// live-monitor-plugin.js
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

const INDEX_SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", ".next",
  "coverage", "__pycache__", ".cache", "vendor",
]);

function scanProjectTree(rootDir, options = {}) {
  const root = path.resolve(rootDir);
  const maxDepth = options.maxDepth ?? 8;
  const maxEntries = options.maxEntries ?? 2500;
  const rootLabel = path.basename(root) || root;
  const budget = { count: 0 };
  const rootNode = {
    name: rootLabel,
    path: "",
    type: "dir",
    visited: false,
    action: null,
    children: [],
  };

  function walkDir(relDir, depth, parent) {
    if (budget.count >= maxEntries || depth > maxDepth) return;
    const absDir = relDir ? path.join(root, relDir) : root;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (budget.count >= maxEntries) break;
      if (ent.name === ".DS_Store") continue;
      const rel = relDir ? `${relDir}${path.sep}${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (INDEX_SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
        budget.count++;
        const dirNode = {
          name: ent.name,
          path: rel,
          type: "dir",
          visited: false,
          action: null,
          children: [],
        };
        parent.children.push(dirNode);
        walkDir(rel, depth + 1, dirNode);
      } else if (ent.isFile()) {
        budget.count++;
        parent.children.push({
          name: ent.name,
          path: rel,
          type: "file",
          visited: false,
          action: null,
          children: [],
        });
      }
    }
    parent.children.sort((a, b) =>
      a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)
    );
  }

  walkDir("", 0, rootNode);
  return { tree: rootNode, entryCount: budget.count, truncated: budget.count >= maxEntries };
}

function createSender(url) {
  let ws = null;
  let connecting = null;
  let lastConnectAttempt = 0;

  const ensureConnected = async () => {
    const now = Date.now();
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    if (connecting) return connecting;

    if (now - lastConnectAttempt < 1000) {
      await new Promise((r) => setTimeout(r, 1000 - (now - lastConnectAttempt)));
    }
    lastConnectAttempt = Date.now();

    connecting = new Promise((resolve, reject) => {
      try {
        ws = new WebSocket(url);
        ws.on("open", () => resolve(ws));
        ws.on("error", () => {
          try {
            ws?.close();
          } catch {}
          ws = null;
          reject(new Error("WebSocket connection failed"));
        });
        ws.on("close", () => {
          ws = null;
        });
      } catch (e) {
        ws = null;
        reject(e);
      }
    }).finally(() => {
      connecting = null;
    });

    return connecting;
  };

  const send = async (data) => {
    try {
      const sock = await ensureConnected();
      sock.send(JSON.stringify(data));
    } catch {
      // Best-effort
    }
  };

  return { send, ensureConnected };
}

class ProjectMonitor {
  constructor(rootDir) {
    this.root = path.resolve(rootDir);
    this.rootLabel = path.basename(this.root) || this.root;
    this.tree = this.makeDirNode(this.rootLabel, "", true);
    this.activeFiles = [];
    this.openDirs = new Set([""]);
  }

  makeDirNode(name, relPath, expanded = false) {
    return {
      name,
      path: relPath,
      type: "dir",
      expanded,
      visited: false,
      action: null,
      children: [],
    };
  }

  makeFileNode(name, relPath) {
    return {
      name,
      path: relPath,
      type: "file",
      expanded: false,
      visited: false,
      action: null,
      children: [],
    };
  }

  toRelative(filePath) {
    if (!filePath) return null;
    const resolved = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.normalize(path.join(this.root, filePath));

    if (resolved.startsWith(this.root + path.sep) || resolved === this.root) {
      return path.relative(this.root, resolved) || "";
    }
    return filePath;
  }

  findDir(relPath) {
    if (relPath === "" || relPath === ".") return this.tree;
    const parts = relPath.split(path.sep).filter(Boolean);
    let node = this.tree;
    for (const part of parts) {
      let child = node.children.find((c) => c.type === "dir" && c.name === part);
      if (!child) return null;
      node = child;
    }
    return node;
  }

  ensureDirChain(relPath) {
    const parts = relPath.split(path.sep).filter(Boolean);
    let node = this.tree;
    let built = "";

    for (const part of parts) {
      built = built ? `${built}${path.sep}${part}` : part;
      let child = node.children.find((c) => c.type === "dir" && c.name === part);
      if (!child) {
        child = this.makeDirNode(part, built, true);
        node.children.push(child);
        node.children.sort((a, b) => sortNodes(a, b));
      }
      child.expanded = true;
      child.visited = true;
      this.openDirs.add(child.path);
      node = child;
    }
    return node;
  }

  touchPath(filePath, action, { isDirectory = false } = {}) {
    const rel = this.toRelative(filePath);
    if (rel == null) return null;

    if (isDirectory || rel === "") {
      const dir = this.ensureDirChain(rel);
      dir.action = action;
      dir.visited = true;
      return { rel, kind: "dir" };
    }

    const dirRel = path.dirname(rel);
    const fileName = path.basename(rel);
    if (dirRel && dirRel !== ".") {
      this.ensureDirChain(dirRel);
    } else {
      this.tree.expanded = true;
      this.tree.visited = true;
    }

    const parent = dirRel && dirRel !== "." ? this.findDir(dirRel) : this.tree;
    if (!parent) return null;

    let fileNode = parent.children.find((c) => c.type === "file" && c.name === fileName);
    if (!fileNode) {
      fileNode = this.makeFileNode(fileName, rel);
      parent.children.push(fileNode);
      parent.children.sort((a, b) => sortNodes(a, b));
    }
    fileNode.visited = true;
    fileNode.action = action;

    this.pushActiveFile(rel, fileName, dirRel === "." ? "" : dirRel, action);
    return { rel, kind: "file" };
  }

  pushActiveFile(rel, name, dir, action) {
    const entry = {
      path: rel,
      name,
      dir: dir || ".",
      dirLabel: dir ? dir : this.rootLabel,
      action,
      at: Date.now(),
    };
    this.activeFiles = [entry, ...this.activeFiles.filter((f) => f.path !== rel)].slice(0, 12);
  }

  snapshot() {
    return {
      projectRoot: this.root,
      projectLabel: this.rootLabel,
      tree: this.tree,
      activeFiles: this.activeFiles,
      openDirs: [...this.openDirs],
    };
  }

  /** Reset touched state (e.g. new user prompt). Keeps tree shape. */
  resetActivity(indexTree) {
    const source = indexTree || this.tree;
    this.tree = cloneTreeReset(source);
    this.activeFiles = [];
    this.openDirs = new Set([""]);
  }
}

function cloneTreeReset(node) {
  return {
    name: node.name,
    path: node.path,
    type: node.type,
    expanded: node.type === "dir" ? !!node.expanded : false,
    visited: false,
    action: null,
    children: (node.children || []).map(cloneTreeReset),
  };
}

function sortNodes(a, b) {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function pickFilePath(input, output) {
  const args = input?.args ?? output?.args ?? {};
  return (
    args.filePath ??
    args.path ??
    args.file ??
    args.target ??
    input?.filePath ??
    output?.filePath
  );
}

function pickToolName(input, output) {
  return (input?.tool ?? output?.tool ?? input?.name ?? "unknown").toLowerCase();
}

function extractStatusMessage(input, output) {
  const bag = output ?? input ?? {};
  const data = bag.data ?? bag;
  const candidates = [
    data?.status,
    data?.message,
    typeof data === "string" ? data : null,
    bag.status,
    bag.message,
    input?.status,
    output?.status,
    input?.message,
    output?.message,
  ];
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return null;
}

function formatStatusMessage(text) {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith("~")) return t;
  return `~ ${t}`;
}

function extractPromptText(input, output) {
  const bag = output ?? input ?? {};
  const msg = bag.message ?? bag;
  const parts = msg.parts ?? bag.parts;
  if (Array.isArray(parts)) {
    const text = parts
      .map((p) => {
        if (typeof p === "string") return p;
        if (p?.type === "text") return p.text ?? p.content ?? "";
        return p?.text ?? p?.content ?? "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  const direct = [
    msg.text,
    msg.content,
    bag.text,
    bag.content,
    typeof msg === "string" ? msg : null,
  ];
  for (const item of direct) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return "";
}

function truncatePrompt(text, max = 220) {
  if (!text) return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function extractMessageRole(input, output) {
  const bag = output ?? input ?? {};
  const msg = bag.message ?? bag;
  const role = (
    bag.role ??
    input?.role ??
    output?.role ??
    msg?.role ??
    msg?.info?.role ??
    input?.message?.role ??
    output?.message?.role ??
    (bag.type === "user" || msg?.type === "user" ? "user" : null) ??
    (bag.type === "assistant" || msg?.type === "assistant" ? "assistant" : null)
  );
  return typeof role === "string" ? role.toLowerCase() : null;
}

const IDLE_STATUS_RE =
  /^(idle|complete|completed|done|finished|stopped|ready|success)$/i;

function isIdleStatusText(raw) {
  if (typeof raw !== "string") return false;
  const t = raw.trim().replace(/^~+\s*/, "");
  if (!t) return false;
  if (IDLE_STATUS_RE.test(t)) return true;
  return /\b(idle|complete|completed|finished|done)\b/i.test(t);
}

function isMessageFinished(input, output) {
  const bag = output ?? input ?? {};
  const msg = bag.message ?? bag;
  const status = (msg.status ?? msg.state ?? bag.status ?? output?.status ?? "")
    .toString()
    .toLowerCase();
  if (["completed", "complete", "done", "idle", "finished"].includes(status)) {
    return true;
  }
  const parts = msg.parts ?? bag.parts;
  if (!Array.isArray(parts) || parts.length === 0) return false;
  return parts.every((p) => {
    if (typeof p === "string") return true;
    if (p?.partial === true || p?.streaming === true) return false;
    if (p?.done === false) return false;
    return true;
  });
}

function extractPaths(root, input, output) {
  const paths = [];
  const primary = pickFilePath(input, output);
  if (primary) paths.push(primary);

  const blob = output?.output ?? output?.content ?? output?.text ?? "";
  if (typeof blob === "string" && blob.length < 50_000) {
    const rootResolved = path.resolve(root);
    for (const line of blob.split("\n")) {
      const trimmed = line.trim().replace(/^[-*]\s+/, "");
      if (!trimmed || trimmed.length > 500) continue;
      if (trimmed.startsWith(rootResolved) || trimmed.startsWith("./") || /^[\w./-]+\.[a-z]+$/i.test(trimmed)) {
        paths.push(trimmed);
      }
    }
  }

  return [...new Set(paths)].slice(0, 24);
}

const DIR_TOOLS = new Set(["list", "glob", "grep"]);
const WRITE_TOOLS = new Set(["write", "edit", "patch", "apply_patch", "multiedit"]);
/** When false, glob tool calls are not shown on the treemap. */
const SHOW_GLOBS = false;
/** When true, new user prompts reset visited colors back to gray (full index). */
const RESET_VISITED_ON_PROMPT = true;

export default async function liveMonitorPlugin(ctx) {
  console.log("[live-monitor] plugin loaded");

  const projectRoot = ctx.directory || ctx.worktree || process.cwd();
  const monitor = new ProjectMonitor(projectRoot);
  let indexTreeCache = null;
  let lastPrompt = null;
  let lastAssistantSummary = null;
  let activeWritePath = null;
  let agentPhase = "idle";
  let resetSeq = 0;

  const monitorUrl =
    process.env.AICODE_MONITOR_WS_URL ||
    process.env.OPENCODE_MONITOR_WS_URL ||
    "ws://localhost:8765";
  const sender = createSender(monitorUrl);

  const push = async (payload) => {
    const snap = monitor.snapshot();
    if (payload.type === "status") {
      await sender.send({
        type: "status",
        projectRoot: snap.projectRoot,
        projectLabel: snap.projectLabel,
        ...payload,
      });
      return;
    }
    await sender.send({
      type: "update",
      resetSeq,
      at: Date.now(),
      ...snap,
      ...payload,
    });
  };

  function normPathPlugin(p) {
    return (p || "").replace(/\\/g, "/");
  }

  const emitActivity = async (relPath, action) => {
    const normalized = relPath ? normPathPlugin(relPath) : null;
    if (!normalized || !action) return;
    const dir =
      normalized.includes("/")
        ? normalized.slice(0, normalized.lastIndexOf("/"))
        : "";
    const name = normalized.includes("/")
      ? normalized.slice(normalized.lastIndexOf("/") + 1)
      : normalized;
    await sender.send({
      type: "activity_event",
      path: normalized,
      dir,
      name,
      action,
      at: Date.now(),
    });
  };

  const record = async (filePath, action, opts = {}) => {
    if (!filePath) return;
    const touched = monitor.touchPath(filePath, action, opts);
    const rel = touched?.rel ?? monitor.toRelative(filePath);
    if (rel != null && action) await emitActivity(rel, action);
    await push({
      log: formatLog(filePath, action, opts),
    });
  };

  const sendAgentStatus = async (phase, message, extra = {}) => {
    if (phase === "working" || phase === "prompt_submitted") agentPhase = "working";
    if (phase === "complete" || phase === "idle") agentPhase = "idle";
    await sender.send({
      type: "agent_status",
      phase,
      message,
      prompt: extra.prompt ?? lastPrompt ?? undefined,
      summary: extra.summary ?? undefined,
      resetSeq: extra.resetSeq ?? undefined,
      activeFile: extra.activeFile ?? activeWritePath ?? undefined,
      projectLabel: monitor.rootLabel,
      at: Date.now(),
    });
  };

  const sendFileProgress = async (relPath, active, tool) => {
    const normalized = relPath ? normPathPlugin(relPath) : null;
    if (!normalized) return;
    if (active) {
      activeWritePath = normalized;
      await emitActivity(normalized, "write");
    } else if (activeWritePath === normalized) {
      activeWritePath = null;
    }
    await sender.send({
      type: "file_progress",
      path: normalized,
      active,
      tool,
      at: Date.now(),
    });
  };

  const forwardSessionStatus = async (input, output) => {
    if (agentPhase === "idle") return;
    const raw = extractStatusMessage(input, output);
    if (!raw) return;
    if (isIdleStatusText(raw)) {
      await markPromptComplete(raw);
      return;
    }
    await sendAgentStatus("working", formatStatusMessage(raw));
  };

  let lastCompleteAt = 0;
  const markPromptComplete = async (summaryText) => {
    const now = Date.now();
    if (agentPhase === "idle" && now - lastCompleteAt < 400) return;
    lastCompleteAt = now;
    if (activeWritePath) await sendFileProgress(activeWritePath, false, "write");
    const summary =
      truncatePrompt(summaryText || lastAssistantSummary || "", 480) || null;
    const statusLine = summary
      ? `~ Done — ${truncatePrompt(summary, 160)}`
      : "~ Prompt complete — agent idle";
    await sendAgentStatus("complete", statusLine, {
      prompt: lastPrompt,
      summary: summary ?? undefined,
    });
    await sender.send({
      type: "status",
      status: "session_idle",
      projectRoot: monitor.root,
      projectLabel: monitor.rootLabel,
      summary: summary ?? undefined,
      log: summary
        ? `<strong class="text-sky-400">Done</strong> <span class="text-zinc-400">${summary}</span>`
        : '<span class="text-slate-500">Prompt complete — agent idle</span>',
      at: Date.now(),
    });
  };

  const onNewUserPrompt = async (input, output) => {
    const promptText = truncatePrompt(extractPromptText(input, output));
    lastPrompt = promptText || null;
    lastAssistantSummary = null;
    agentPhase = "working";
    if (RESET_VISITED_ON_PROMPT) {
      await broadcastReset("user.prompt");
    }
    await sendAgentStatus("prompt_submitted", "~ Prompt submitted", {
      prompt: lastPrompt,
      resetSeq,
    });
    await push({
      log: `<span class="text-zinc-500">New prompt</span>${lastPrompt ? `: <em>${lastPrompt}</em>` : ""}`,
    });
  };

  const broadcastReset = async (reason) => {
    if (!RESET_VISITED_ON_PROMPT) return;
    resetSeq += 1;
    monitor.resetActivity(indexTreeCache);
    activeWritePath = null;
    const resetTree = indexTreeCache
      ? cloneTreeReset(indexTreeCache)
      : cloneTreeReset(monitor.tree);
    monitor.tree = cloneTreeReset(resetTree);
    await sender.send({
      type: "session_reset",
      reason,
      resetSeq,
      projectRoot: monitor.root,
      projectLabel: monitor.rootLabel,
      tree: resetTree,
      activeFiles: [],
      at: Date.now(),
    });
  };

  const sendProjectIndex = async () => {
    if (process.env.AICODE_MONITOR_SKIP_INDEX === "1") return;
    try {
      const { tree, entryCount, truncated } = scanProjectTree(monitor.root);
      indexTreeCache = cloneTreeReset(tree);
      await sender.send({
        type: "project_index",
        projectRoot: monitor.root,
        projectLabel: monitor.rootLabel,
        tree,
        indexMeta: { entryCount, truncated },
      });
    } catch (err) {
      console.warn("[live-monitor] project index scan failed:", err?.message || err);
    }
  };

  try {
    await sender.ensureConnected();
    await sendProjectIndex();
    await push({
      type: "status",
      status: "plugin_connected",
      log: `<strong class="text-emerald-400">Monitoring</strong> <code>${monitor.rootLabel}</code> — explorer will grow as the agent reads files.`,
    });
  } catch {
    await push({
      type: "status",
      status: "plugin_waiting",
      log: '<strong class="text-amber-400">Plugin loaded</strong> — start the monitor server (<code>npm start</code>) to see live updates.',
    });
  }

  return {
    "session.created": async () => {
      await broadcastReset("session.created");
      await push({
        log: `<span class="text-zinc-500">New session — treemap reset</span>`,
      });
    },

    "message.updated": async (input, output) => {
      const role = extractMessageRole(input, output);
      if (role === "user") {
        await onNewUserPrompt(input, output);
        return;
      }
      if (role === "assistant") {
        const text = extractPromptText(input, output);
        if (text) lastAssistantSummary = truncatePrompt(text, 480);
        if (text && isMessageFinished(input, output)) {
          await markPromptComplete(text);
        }
        return;
      }
      await forwardSessionStatus(input, output);
    },

    "message.part.updated": async (input, output) => {
      if (extractMessageRole(input, output) !== "assistant") return;
      const text = extractPromptText(input, output);
      if (!text) return;
      lastAssistantSummary = truncatePrompt(text, 480);
      if (isMessageFinished(input, output)) {
        await markPromptComplete(text);
      }
    },

    "tui.prompt.append": async (input, output) => {
      const text = truncatePrompt(extractPromptText(input, output));
      if (text) lastPrompt = text;
    },

    "session.status": async (input, output) => {
      const raw = extractStatusMessage(input, output);
      if (raw && isIdleStatusText(raw)) {
        await markPromptComplete(raw);
        return;
      }
      await forwardSessionStatus(input, output);
    },

    "file.edited": async (input, output) => {
      const filePath = pickFilePath(input, output) ?? input?.filePath ?? output?.filePath;
      const rel = filePath ? monitor.toRelative(filePath) : null;
      if (rel) await sendFileProgress(rel, false, "edit");
      await record(filePath, "edit");
    },

    "tool.execute.before": async (input, output) => {
      const tool = pickToolName(input, output);
      const primary = pickFilePath(input, output);
      const rel = primary ? monitor.toRelative(primary) : null;

      if (WRITE_TOOLS.has(tool) && rel) {
        await sendFileProgress(rel, true, tool);
        const name = path.basename(rel);
        await sendAgentStatus("working", `~ Preparing ${tool} ${name}…`, {
          activeFile: rel,
        });
        return;
      }

      if (tool === "read" && rel) {
        const name = path.basename(rel);
        await sendAgentStatus("working", `~ Reading ${name}…`, { activeFile: rel });
      }
    },

    "tool.execute.after": async (input, output) => {
      const tool = pickToolName(input, output);
      const primary = pickFilePath(input, output);
      const rel = primary ? monitor.toRelative(primary) : null;

      if (WRITE_TOOLS.has(tool) && rel) {
        await sendFileProgress(rel, false, tool);
      }

      if (tool === "read" && primary) {
        await record(primary, "read");
        return;
      }

      if (DIR_TOOLS.has(tool)) {
        if (tool === "glob" && !SHOW_GLOBS) {
          return;
        }
        const paths = extractPaths(monitor.root, input, output);
        if (primary) {
          await record(primary, tool, { isDirectory: true });
        }
        if (tool !== "glob" || SHOW_GLOBS) {
          for (const p of paths) {
            const rel = monitor.toRelative(p);
            if (!rel) continue;
            const isDir = !path.extname(path.basename(rel));
            monitor.touchPath(p, tool, { isDirectory: isDir });
          }
        }
        await push({
          log: `<strong class="text-violet-400">${tool}</strong> explored <code>${primary || monitor.rootLabel}</code>${paths.length ? ` (+${paths.length} paths)` : ""}`,
        });
        return;
      }

      if (primary) {
        await record(primary, tool);
        return;
      }

      await push({
        log: `<strong>Tool:</strong> ${tool}`,
      });
    },

    "permission.replied": async (input, output) => {
      const data = output ?? input?.data ?? input ?? {};
      const { action, target, decision } = data;
      if (action === "read" && decision === "allow" && target) {
        await record(target, "read");
      }
    },

    "session.updated": async (input, output) => {
      const raw = extractStatusMessage(input, output);
      if (raw && isIdleStatusText(raw)) {
        await markPromptComplete(raw);
        return;
      }
      await forwardSessionStatus(input, output);
      if (raw) {
        await push({
          log: `<span class="text-slate-400">${formatStatusMessage(raw)}</span>`,
        });
      }
    },

    event: async ({ event }) => {
      if (!event?.type) return;
      if (event.type === "session.idle") {
        await markPromptComplete();
        return;
      }
      if (event.type === "session.status" || event.type === "session.updated") {
        const raw =
          event.data?.status ??
          event.data?.message ??
          (typeof event.data === "string" ? event.data : null);
        if (typeof raw === "string" && raw.trim()) {
          if (isIdleStatusText(raw)) {
            await markPromptComplete(raw);
            return;
          }
          if (agentPhase !== "idle") {
            await sendAgentStatus("working", formatStatusMessage(raw));
          }
        }
      }
    },

    "session.idle": async () => {
      await markPromptComplete();
    },
  };
}

function formatLog(filePath, action, opts) {
  const label = path.basename(filePath) || filePath;
  if (action === "read") {
    return `<strong class="text-blue-400">Read</strong> ${label}`;
  }
  if (action === "edit") {
    return `<strong class="text-emerald-400">Edited</strong> ${label}`;
  }
  if (opts.isDirectory) {
    return `<strong class="text-violet-400">Opened folder</strong> <code>${filePath}</code>`;
  }
  return `<strong class="text-amber-400">${action}</strong> ${label}`;
}
