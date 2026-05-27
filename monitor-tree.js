/**
 * Shared tree state helpers for Tree and Radial views.
 * Attach to window.MonitorTree for classic script loading.
 */
(function (global) {
  function normPath(p) {
    return (p || "").replace(/\\/g, "/");
  }

  function sortNodes(a, b) {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  }

  function cloneTree(n) {
    return {
      name: n.name,
      path: n.path ?? "",
      type: n.type || "file",
      visited: !!n.visited,
      action: n.action || null,
      expanded: !!n.expanded,
      children: (n.children || []).map(cloneTree),
    };
  }

  function hasVisitedDescendant(node) {
    for (const c of node.children || []) {
      if (c.visited) return true;
      if (c.type === "dir" && hasVisitedDescendant(c)) return true;
    }
    return false;
  }

  function createTreeApi(userCollapsed) {
    function isExpanded(node) {
      if (node.type !== "dir") return false;
      if (userCollapsed.has(node.path)) return false;
      if (node.expanded) return true;
      if (node.children?.length && node.visited) return true;
      return node.children?.length > 0 && hasVisitedDescendant(node);
    }

    function expandVisitedAncestors(node) {
      let any = !!node.visited;
      for (const c of node.children || []) {
        if (expandVisitedAncestors(c)) any = true;
      }
      if (any && node.type === "dir") node.expanded = true;
      return any;
    }

    function toHierarchy(node, focus) {
      const d = {
        name: node.name,
        path: node.path,
        type: node.type,
        action: node.action,
        visited: node.visited,
        isFocus: node.path === focus && node.type === "file",
      };
      if (node.type === "dir" && node.children?.length) {
        const kids = node.children.map((c) => toHierarchy(c, focus));
        if (isExpanded(node)) d.children = kids;
        else d._children = kids;
      }
      return d;
    }

    function mergeActivityTree(base, activity) {
      function mergeNode(target, act) {
        if (!target || !act) return;
        if (act.visited) target.visited = true;
        if (act.action) target.action = act.action;
        if (act.expanded) target.expanded = true;
        for (const ac of act.children || []) {
          let tc = (target.children || []).find((c) => c.path === ac.path);
          if (!tc) {
            tc = cloneTree(ac);
            target.children = target.children || [];
            target.children.push(tc);
            target.children.sort(sortNodes);
          }
          mergeNode(tc, ac);
        }
      }
      mergeNode(base, activity);
    }

    /** Full project index: show all folders/files unless user collapsed. */
    function toHierarchyIndexed(node, focus) {
      const d = {
        name: node.name,
        path: node.path,
        type: node.type,
        action: node.action,
        visited: node.visited,
        isFocus: node.path === focus && node.type === "file",
      };
      if (node.children?.length) {
        const kids = node.children.map((c) => toHierarchyIndexed(c, focus));
        if (node.type === "dir" && userCollapsed.has(node.path)) {
          d._children = kids;
        } else {
          d.children = kids;
        }
      }
      return d;
    }

    return {
      isExpanded,
      expandVisitedAncestors,
      toHierarchy,
      toHierarchyIndexed,
      mergeActivityTree,
    };
  }

  /** Base label size × 1.5, then −10% per depth level. */
  function nodeFontSizePx(basePx, depth) {
    return basePx * 1.5 * 0.9 ** Math.max(0, depth);
  }

  /** Parent→child links: 5pt at first level, thinner for deeper targets. */
  function linkStrokeWidthPx(targetDepth) {
    if (targetDepth <= 0) return 5;
    return Math.max(0.75, 5 * 0.9 ** (targetDepth - 1));
  }

  global.MonitorTree = {
    normPath,
    sortNodes,
    cloneTree,
    hasVisitedDescendant,
    createTreeApi,
    nodeFontSizePx,
    linkStrokeWidthPx,
  };
})(typeof window !== "undefined" ? window : globalThis);
