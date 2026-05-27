/**
 * File text preview popover (shared by Treemap, Tree, Radial, Horizon).
 * Attach to window.MonitorPreview for classic script loading.
 */
(function (global) {
  const POPOVER_HTML = `
    <div
      id="preview-popover"
      class="fixed right-4 top-20 w-[400px] h-[500px] max-w-full max-h-[calc(100vh-6rem)] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl shadow-black/70 hidden z-50 flex flex-col overflow-hidden"
      role="dialog"
      aria-label="File preview"
    >
      <div class="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/90 text-xs">
        <div class="flex flex-col overflow-hidden min-w-0">
          <span id="preview-title" class="font-mono truncate text-zinc-200 inline-flex items-center gap-2">
            <i class="fa-solid fa-file-code fa-icon-sm" aria-hidden="true"></i>
            <span id="preview-title-text">Preview</span>
          </span>
          <span id="preview-subtitle" class="text-[10px] text-zinc-500 truncate">—</span>
        </div>
        <button
          id="preview-close"
          type="button"
          class="rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0 inline-flex items-center gap-1"
          aria-label="Close preview"
        >
          <i class="fa-solid fa-xmark fa-icon-sm" aria-hidden="true"></i>
          Close
        </button>
      </div>
      <div class="flex-1 min-h-0 bg-zinc-950/95">
        <pre
          id="preview-body"
          class="h-full w-full text-[11px] leading-relaxed font-mono text-zinc-200 px-3 py-2 overflow-auto whitespace-pre-wrap"
        ></pre>
      </div>
    </div>`;

  let previewPath = "";
  let initialized = false;

  function normPath(p) {
    return (p || "").replace(/\\/g, "/");
  }

  function mount() {
    if (document.getElementById("preview-popover")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = POPOVER_HTML.trim();
    document.body.appendChild(wrap.firstElementChild);
  }

  function close() {
    previewPath = "";
    const pop = document.getElementById("preview-popover");
    if (pop) pop.classList.add("hidden");
  }

  async function open(path, label) {
    mount();
    previewPath = normPath(path);
    const pop = document.getElementById("preview-popover");
    const titleTextEl = document.getElementById("preview-title-text");
    const subtitleEl = document.getElementById("preview-subtitle");
    const bodyEl = document.getElementById("preview-body");
    if (!pop || !titleTextEl || !subtitleEl || !bodyEl || !previewPath) return;

    titleTextEl.textContent = label || previewPath.split("/").pop() || previewPath;
    subtitleEl.textContent = previewPath;
    bodyEl.textContent = "Loading preview…";
    pop.classList.remove("hidden");

    try {
      const resp = await fetch(`/preview?path=${encodeURIComponent(previewPath)}`);
      if (!resp.ok) {
        bodyEl.textContent = `Unable to load preview (HTTP ${resp.status}).`;
        return;
      }
      const text = await resp.text();
      bodyEl.textContent = text || "[File is empty]";
    } catch {
      bodyEl.textContent = "Error loading preview.";
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    mount();
    document.getElementById("preview-close")?.addEventListener("click", close);
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
  }

  global.MonitorPreview = {
    init,
    open,
    close,
    normPath,
  };
})(typeof window !== "undefined" ? window : globalThis);
