/**
 * Action-color legend (shared by Tree, Radial, Treemap, Horizon).
 */
(function (global) {
  const LEGEND_ACTION_ICONS = {
    read: "fa-book-open",
    edit: "fa-pen",
    list: "fa-list",
    glob: "fa-globe",
    grep: "fa-magnifying-glass",
    write: "fa-pen-to-square",
  };

  /**
   * @param {HTMLElement} containerEl
   * @param {object} [options]
   * @param {Record<string, string>} [options.colors]
   * @param {string[]} [options.exclude]
   */
  function initLegend(containerEl, options = {}) {
    if (!containerEl || !global.MonitorHighlights) return;
    const colors = options.colors || global.MonitorHighlights.ACTION_COLORS;
    const exclude = new Set(options.exclude || ["bash"]);
    const fontPx = options.fontPx ?? 10;
    const swatchPx = options.swatchPx ?? 8;

    containerEl.classList.add("monitor-legend", "flex", "flex-wrap", "items-center", "gap-x-3", "gap-y-1");
    containerEl.innerHTML = Object.entries(colors)
      .filter(([k]) => !exclude.has(k))
      .map(([k, c]) => {
        const fa = LEGEND_ACTION_ICONS[k] || "fa-circle";
        return (
          `<span class="monitor-legend-item inline-flex items-center gap-1.5" style="font-size:${fontPx}px;line-height:1.2">` +
          `<span class="monitor-legend-swatch inline-block rounded-sm shrink-0" style="background:${c};width:${swatchPx}px;height:${swatchPx}px"></span>` +
          `<i class="fa-solid ${fa} fa-icon-sm opacity-80" aria-hidden="true"></i>` +
          `<span>${k}</span></span>`
        );
      })
      .join("");
  }

  global.MonitorLegend = { initLegend, LEGEND_ACTION_ICONS };
})(typeof window !== "undefined" ? window : globalThis);
