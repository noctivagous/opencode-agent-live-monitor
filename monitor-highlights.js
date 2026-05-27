/**
 * Active file highlight flashes for Tree and Radial views.
 */
(function (global) {
  const FLASH_MS = 2000;

  const ACTION_COLORS = {
    read: "#2563eb",
    edit: "#16a34a",
    list: "#7c3aed",
    glob: "#9333ea",
    grep: "#a855f7",
    write: "#ca8a04",
    bash: "#ca8a04",
  };

  function normPath(p) {
    return (p || "").replace(/\\/g, "/");
  }

  function createHighlightStore() {
    const map = new Map();

    function stamp(path, action) {
      const key = normPath(path);
      if (!key || !action) return;
      map.set(key, { action, until: Date.now() + FLASH_MS });
    }

    function getAction(path) {
      const key = normPath(path);
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.until <= Date.now()) {
        map.delete(key);
        return null;
      }
      return entry.action;
    }

    function stampFromTree(node) {
      if (!node) return;
      const action = node.action;
      if (node.visited && action) stamp(node.path, action);
      for (const c of node.children || []) stampFromTree(c);
    }

    function clear() {
      map.clear();
    }

    return { stamp, getAction, stampFromTree, clear };
  }

  global.MonitorHighlights = {
    FLASH_MS,
    ACTION_COLORS,
    createHighlightStore,
    normPath,
  };
})(typeof window !== "undefined" ? window : globalThis);
