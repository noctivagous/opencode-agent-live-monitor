/**
 * Pan/zoom helpers for Tree, Radial, Treemap, and Horizon views.
 * Attach to window.MonitorZoom for classic script loading.
 */
(function (global) {
  const RESET_BTN_CLASS =
    "monitor-zoom-reset rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-zinc-700/80 bg-zinc-900/90";

  /**
   * @param {object} [options]
   * @param {[number,number]} [options.scaleExtent]
   * @param {(event: any) => void} [options.onZoom]
   */
  function createZoomHost(options = {}) {
    const scaleExtent = options.scaleExtent || [0.15, 3];
    const zoomListeners = new Set();
    let savedTransform = null;
    let zoomBehavior = null;
    let svg = null;
    let zoomLayer = null;
    let container = null;

    function notifyZoom(event) {
      zoomListeners.forEach((fn) => {
        try {
          fn(event);
        } catch (err) {
          console.warn("[MonitorZoom] zoom listener error", err);
        }
      });
    }

    function getTransform() {
      return savedTransform || (global.d3 ? global.d3.zoomIdentity : { k: 1, x: 0, y: 0 });
    }

    function setTransform(t) {
      savedTransform = t;
      if (zoomLayer && t) {
        zoomLayer.attr("transform", t);
      }
    }

    function captureFromSvg() {
      if (!svg || !global.d3) return;
      const node = svg.node?.();
      if (node) {
        const t = global.d3.zoomTransform(node);
        if (t) savedTransform = t;
      }
    }

    /**
     * @param {import('d3').Selection} svgSelection
     * @param {import('d3').Selection} zoomLayerSelection
     * @param {HTMLElement} containerEl
     */
    function bind(svgSelection, zoomLayerSelection, containerEl) {
      if (!global.d3) return null;
      svg = svgSelection;
      zoomLayer = zoomLayerSelection;
      container = containerEl;

      zoomBehavior = global.d3
        .zoom()
        .scaleExtent(scaleExtent)
        .on("zoom", (event) => {
          savedTransform = event.transform;
          zoomLayer.attr("transform", event.transform);
          if (options.onZoom) options.onZoom(event);
          notifyZoom(event);
        });

      svg.call(zoomBehavior);
      svg.call(zoomBehavior.transform, getTransform());
      notifyZoom({ transform: getTransform() });
      return zoomBehavior;
    }

    function resetTo100() {
      if (!global.d3) return;
      savedTransform = global.d3.zoomIdentity;
      if (svg && zoomBehavior) {
        svg
          .transition()
          .duration(250)
          .call(zoomBehavior.transform, global.d3.zoomIdentity)
          .on("end", () => notifyZoom({ transform: global.d3.zoomIdentity }));
      } else if (zoomLayer) {
        zoomLayer.attr("transform", null);
        notifyZoom({ transform: global.d3.zoomIdentity });
      }
    }

    /**
     * Fit content bounds into the viewport (pan/zoom).
     * @param {{ x0: number, y0: number, x1: number, y1: number }} bounds
     * @param {number} viewportW
     * @param {number} viewportH
     * @param {number} [padding]
     * @param {boolean} [animate]
     */
    function fitToContent(bounds, viewportW, viewportH, padding = 48, animate = true) {
      if (!global.d3 || !svg || !zoomBehavior) return;
      const dx = Math.max(bounds.x1 - bounds.x0, 1);
      const dy = Math.max(bounds.y1 - bounds.y0, 1);
      const scale = Math.min(
        scaleExtent[1],
        Math.max(scaleExtent[0], 0.9 / Math.max(dx / viewportW, dy / viewportH))
      );
      const tx = viewportW / 2 - scale * ((bounds.x0 + bounds.x1) / 2);
      const ty = viewportH / 2 - scale * ((bounds.y0 + bounds.y1) / 2);
      savedTransform = global.d3.zoomIdentity.translate(tx, ty).scale(scale);
      if (animate) {
        svg
          .transition()
          .duration(450)
          .call(zoomBehavior.transform, savedTransform)
          .on("end", () => notifyZoom({ transform: savedTransform }));
      } else {
        svg.call(zoomBehavior.transform, savedTransform);
        notifyZoom({ transform: savedTransform });
      }
    }

    function getBehavior() {
      return zoomBehavior;
    }

    function addZoomListener(fn) {
      zoomListeners.add(fn);
      return () => zoomListeners.delete(fn);
    }

    function getMagnificationPercent() {
      const k = getTransform().k ?? 1;
      return `${Math.round(k * 100)}%`;
    }

    return {
      bind,
      resetTo100,
      fitToContent,
      getTransform,
      setTransform,
      captureFromSvg,
      getBehavior,
      addZoomListener,
      getMagnificationPercent,
    };
  }

  /**
   * @param {HTMLElement} parentEl
   * @param {ReturnType<typeof createZoomHost>} host
   * @param {string} [label]
   */
  function attachResetButton(parentEl, host, label = "100%") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = RESET_BTN_CLASS;
    btn.innerHTML = `<i class="fa-solid fa-compress fa-icon-sm" aria-hidden="true"></i> ${label}`;
    btn.title = "Reset zoom to 100%";
    btn.className = `${RESET_BTN_CLASS} inline-flex items-center gap-1.5`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      host.resetTo100();
    });
    parentEl.appendChild(btn);
    return btn;
  }

  /**
   * Hint text + live magnification % + reset button.
   * @param {HTMLElement} parentEl
   * @param {ReturnType<typeof createZoomHost>} host
   * @param {object} [options]
   * @param {string} [options.hint] e.g. "Scroll/zoom · click folders to collapse"
   * @param {string} [options.hintIcon]
   */
  function attachZoomControls(parentEl, host, options = {}) {
    const wrap = document.createElement("span");
    wrap.className = "monitor-zoom-controls inline-flex flex-wrap items-center gap-2";

    const hint = document.createElement("span");
    hint.className = "toolbar-hint inline-flex items-center gap-1 flex-wrap";
    const icon = options.hintIcon || "fa-arrows-up-down-left-right";
    const hintText = options.hint || "Scroll/zoom";
    hint.innerHTML = `<i class="fa-solid ${icon} fa-icon-sm" aria-hidden="true"></i>`;
    hint.append(document.createTextNode(` ${hintText} · `));
    const pct = document.createElement("span");
    pct.className = "monitor-zoom-pct font-mono text-zinc-400 tabular-nums";
    hint.append(pct);
    wrap.append(hint);

    attachResetButton(wrap, host);

    const updatePct = () => {
      pct.textContent = host.getMagnificationPercent();
    };
    host.addZoomListener(updatePct);
    updatePct();

    parentEl.append(wrap);
    return { updatePct };
  }

  global.MonitorZoom = {
    createZoomHost,
    attachResetButton,
    attachZoomControls,
    RESET_BTN_CLASS,
  };
})(typeof window !== "undefined" ? window : globalThis);
