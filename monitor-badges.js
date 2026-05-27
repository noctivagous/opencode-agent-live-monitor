/**
 * Status badges with Font Awesome icons (requires all.min.css).
 */
(function (global) {
  const BADGE_ICONS = {
    "status-browser": "fa-solid fa-display",
    "status-plugin": "fa-solid fa-plug",
    "status-index": "fa-solid fa-database",
    "status-agent": "fa-solid fa-robot",
  };

  const TONES = {
    ok: "bg-emerald-950 text-emerald-300",
    warn: "bg-amber-950 text-amber-300",
    bad: "bg-red-950 text-red-300",
    idle: "bg-zinc-800 text-zinc-400",
  };

  const TONES_RING = {
    ok: "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-800",
    warn: "bg-amber-950 text-amber-300 ring-1 ring-amber-800",
    bad: "bg-red-950 text-red-300 ring-1 ring-red-800",
    idle: "bg-zinc-800 text-zinc-400",
  };

  function setBadge(id, text, tone) {
    const el = document.getElementById(id);
    if (!el) return;
    const icon = BADGE_ICONS[id] || "fa-solid fa-circle";
    const sm = el.classList.contains("monitor-badge--sm");
    const tones = el.dataset.badgeRing === "true" ? TONES_RING : TONES;
    el.className = `monitor-badge inline-flex items-center gap-1.5 ${sm ? "monitor-badge--sm " : ""}${tones[tone] || tones.idle}`;
    el.innerHTML = `<i class="${icon} fa-icon-sm" aria-hidden="true"></i> ${text}`;
  }

  global.MonitorBadges = { setBadge };
})(typeof window !== "undefined" ? window : globalThis);
