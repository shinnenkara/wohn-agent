export function progressPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apartment progress</title>
<script>
(function () {
  var stored = localStorage.getItem("theme");
  var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
})();
</script>
<style>
  :root {
    color-scheme: light;
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --card: oklch(1 0 0);
    --muted: oklch(0.556 0 0);
    --border: oklch(0.922 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --accent: oklch(0.97 0 0);
    --flow-on: oklch(0.68 0.14 155);
    --flow-off: oklch(0.68 0.12 25);
    --flow-hold: oklch(0.75 0.12 75);
  }
  html.dark {
    color-scheme: dark;
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.205 0 0);
    --muted: oklch(0.708 0 0);
    --border: oklch(1 0 0 / 12%);
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --accent: oklch(0.269 0 0);
    --flow-on: oklch(0.74 0.14 155);
    --flow-off: oklch(0.72 0.12 25);
    --flow-hold: oklch(0.8 0.12 85);
  }
  body {
    margin: 0; padding: 24px; line-height: 1.4;
    background: var(--background); color: var(--foreground);
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
  h1 { font-size: 1.4rem; font-weight: 600; margin: 0; }
  p { margin: 0 0 16px; }
  .theme { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 0.85rem; }
  .switch {
    width: 36px; height: 20px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--accent); padding: 0; position: relative; cursor: pointer;
  }
  .switch span {
    position: absolute; top: 1px; left: 1px; width: 16px; height: 16px; border-radius: 999px;
    background: var(--foreground); transition: transform 160ms ease;
  }
  html.dark .switch span { transform: translateX(16px); }
  .diagram { position: relative; width: min(960px, 100%); height: auto; }
  .diagram svg { width: 100%; height: 100%; display: block; }
  .band { fill: var(--flow-on); opacity: 0.9; transition: opacity 160ms ease; }
  .band.on { fill: var(--flow-on); }
  .band.off { fill: var(--flow-off); }
  .band.hold { fill: var(--flow-hold); }
  .band.dim { opacity: 0.18; }
  .join { opacity: 0.9; transition: opacity 160ms ease; }
  .join.on { fill: var(--flow-on); }
  .join.off { fill: var(--flow-off); }
  .join.hold { fill: var(--flow-hold); }
  .join.dim { opacity: 0.18; }
  .node {
    position: absolute; box-sizing: border-box; min-height: 32px; border: 1px solid var(--border);
    border-left-width: 3px; background: var(--card); color: var(--foreground);
    text-align: left; padding: 4px 8px; cursor: pointer; font: inherit; border-radius: 6px;
    white-space: nowrap; transform: translate(8px, -50%); z-index: 1;
  }
  .node.on { border-left-color: var(--flow-on); }
  .node.off { border-left-color: var(--flow-off); }
  .node.hold { border-left-color: var(--flow-hold); }
  .node.above { transform: translate(-50%, calc(-100% - 6px)); }
  .node.mid { transform: translate(-50%, -50%); }
  .node.end { transform: translate(calc(-100% - 8px), -50%); }
  .node span { color: var(--muted); margin-left: 6px; }
  .node.dim { opacity: 0.45; }
  .node[aria-pressed="true"] { outline: 2px solid var(--primary); }
  #closed-line { margin: 0 0 16px; }
  #closed-node { font: inherit; border: 1px solid var(--border); border-left: 3px solid var(--flow-off); background: var(--card); color: var(--foreground); padding: 4px 8px; cursor: pointer; border-radius: 6px; }
  #closed-node span { color: var(--muted); margin-left: 6px; }
  table { border-collapse: collapse; width: min(960px, 100%); }
  th, td { border-bottom: 1px solid var(--border); text-align: left; padding: 6px 8px; }
  .flow-table { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); border: 0; }
  .tabs { display: flex; gap: 8px; margin: 8px 0 16px; }
  .tabs button { font: inherit; background: transparent; color: var(--foreground); border: 1px solid var(--border); padding: 6px 12px; cursor: pointer; border-radius: 6px; }
  .tabs button[aria-selected="true"] { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
  .cards { display: grid; gap: 16px; max-width: 36rem; }
  .card { border: 1px solid var(--border); background: var(--card); border-radius: 8px; padding: 20px; min-width: 0; overflow-wrap: anywhere; scroll-margin-top: 16px; }
  .card.linked { outline: 2px solid var(--primary); }
  .card h3 { margin: 0 0 4px; font-size: 1rem; }
  .card h3 a { color: inherit; text-decoration: none; }
  .card h3 a:hover { text-decoration: underline; }
  .card .preview { display: block; width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin: 0 0 16px; }
  .listing { margin-bottom: 16px; }
  .card .listing p { margin: 0 0 4px; }
  .card .listing p:last-child { margin-bottom: 0; }
  .card .listing .facts { margin-top: 8px; }
  .card button, .link-mail button, .task-actions button { font: inherit; background: transparent; color: var(--foreground); border: 1px solid var(--border); padding: 6px 12px; cursor: pointer; border-radius: 6px; }
  .task-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .task-actions button:disabled { opacity: 0.5; cursor: default; }
  .task-note { white-space: pre-wrap; }
  .link-mail { display: flex; gap: 8px; align-items: center; margin: 8px 0 16px; flex-wrap: wrap; }
  .link-mail input { font: inherit; background: var(--background); color: var(--foreground); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
  .card p, .card ul { margin: 0 0 8px; }
  .card ul { margin-top: 16px; }
  .card li + li { margin-top: 16px; }
  .mail-body { margin: 8px 0; }
  .mail-body summary { cursor: pointer; }
  .card .message { white-space: pre-wrap; max-width: 65ch; margin: 8px 0 0; }
  .muted, .card .muted { color: var(--muted); }
  a { color: var(--foreground); }
  .draft { white-space: pre-wrap; margin: 4px 0; }
  .chip { display: inline-block; border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; margin: 0 4px 4px 0; font-size: 0.75rem; }
  .banner { border: 1px solid var(--border); background: var(--accent); padding: 6px 8px; border-radius: 6px; }
  @media (max-width: 700px) {
    .diagram { display: none; }
    .flow-table { position: static; width: auto; height: auto; margin: 0 0 16px; overflow: visible; clip: auto; }
  }
  @media (prefers-reduced-motion: reduce) { .band, .join, .switch span { transition: none; } }
</style>
</head>
<body>
<header>
<h1>Apartment progress</h1>
<label class="theme">Dark
  <button type="button" class="switch" id="theme-switch" role="switch" aria-checked="false" aria-label="Dark mode"><span></span></button>
</label>
</header>
<div class="tabs" role="tablist">
  <button type="button" id="tab-flow" role="tab" aria-selected="true" aria-controls="panel-flow">Flow</button>
  <button type="button" id="tab-tasks" role="tab" aria-selected="false" aria-controls="panel-tasks">Tasks</button>
  <button type="button" id="tab-other" role="tab" aria-selected="false" aria-controls="panel-other">Other</button>
</div>
<div id="panel-flow" role="tabpanel">
<p id="follow">Green stays on the path, salmon has stopped, amber needs you.</p>
<div class="diagram" id="diagram" dir="ltr"></div>
<p id="closed-line"></p>
<table class="flow-table" id="flow-table"></table>
<h2>Apartments</h2>
<div class="cards" id="apartments"><p>Loading…</p></div>
</div>
<div id="panel-tasks" role="tabpanel" hidden>
<h2>Tasks</h2>
<p>Tasks that still need a decision, soonest deadline first.</p>
<p id="task-banner" class="banner" hidden>New urgent task.</p>
<div class="cards" id="tasks"><p>No open actions.</p></div>
</div>
<div id="panel-other" role="tabpanel" hidden>
<h2>Other</h2>
<p>Mail and events that are not attached to an apartment. Unrelated mail is hidden.</p>
<label class="muted" for="show-hidden"><input type="checkbox" id="show-hidden"> Show hidden</label>
<ul id="unlinked"></ul>
</div>
<script>
var pinned = "";
var shown = "";
var taskRows = [];
var taskNotices = {};
var taskBusy = {};
var taskStamp = "";
var taskPrimed = false;
var taskKnownP0 = {};
var taskFreshP0 = {};
var showHidden = false;
var flow = { nodes: [], links: [] };
var spineOrder = ["discovered", "applied", "in_conversation", "viewing_offered", "scheduled"];
var exitOrder = ["filtered_out", "failed", "manual"];
var exitKind = { filtered_out: "off", failed: "off", manual: "hold" };
var stageNames = {
  discovered: "Discovered",
  filtered_out: "Filtered out",
  manual: "Manual",
  failed: "Failed",
  applied: "Applied",
  in_conversation: "In conversation",
  viewing_offered: "Viewing offered",
  scheduled: "Scheduled"
};
var stageIds = Object.keys(stageNames).concat(["closed"]);
var listToken = 0;

function load() {
  var themeSwitch = document.getElementById("theme-switch");
  themeSwitch.setAttribute("aria-checked", document.documentElement.classList.contains("dark") ? "true" : "false");
  themeSwitch.addEventListener("click", toggleTheme);
  document.getElementById("tab-flow").addEventListener("click", function () { selectTab("flow"); });
  document.getElementById("tab-tasks").addEventListener("click", function () { selectTab("tasks"); });
  document.getElementById("tab-other").addEventListener("click", function () { selectTab("other"); });
  document.getElementById("tasks").addEventListener("click", taskAction);
  pollTasks();
  setInterval(pollTasks, 1000);
  fetch("/api/flow").then(function (response) { return response.json(); }).then(function (data) {
    flow = data;
    draw(data);
    drawTable(data);
  });
  document.getElementById("show-hidden").addEventListener("change", function (event) {
    showHidden = event.target.checked;
    loadUnlinked();
  });
  loadUnlinked();
  document.getElementById("apartments").addEventListener("click", readExpose);
  document.getElementById("unlinked").addEventListener("submit", linkMail);
  document.getElementById("unlinked").addEventListener("click", hideMail);
  pinned = stageFromUrl();
  window.addEventListener("popstate", applyFromUrl);
  window.addEventListener("hashchange", onHashChange);
  showApartments(pinned);
}

function toggleTheme() {
  var dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("theme", dark ? "dark" : "light");
  document.getElementById("theme-switch").setAttribute("aria-checked", dark ? "true" : "false");
}

function selectTab(name) {
  ["flow", "tasks", "other"].forEach(function (tab) {
    var on = tab === name;
    document.getElementById("tab-" + tab).setAttribute("aria-selected", on ? "true" : "false");
    document.getElementById("panel-" + tab).hidden = !on;
  });
}

function pollTasks() {
  fetch("/api/tasks").then(function (response) {
    if (!response.ok) return;
    return response.json();
  }).then(function (rows) {
    if (rows) drawTasks(rows);
  }).catch(function () { return undefined; });
}

function drawTasks(rows) {
  taskRows = rows || [];
  var urgent = noteUrgent(taskRows);
  document.getElementById("tab-tasks").textContent = "Tasks (" + taskRows.length + ")" + (urgent ? " · P0" : "");
  var stamp = JSON.stringify({ rows: taskRows, notices: taskNotices, busy: taskBusy });
  if (stamp === taskStamp) return;
  taskStamp = stamp;
  var host = document.getElementById("tasks");
  if (!taskRows.length) {
    host.innerHTML = "<p>No open actions.</p>";
    return;
  }
  host.innerHTML = taskRows.map(taskCard).join("");
}

function noteUrgent(rows) {
  var current = {};
  rows.forEach(function (row) {
    if (row.priority === "P0_CRITICAL") current[row.id] = true;
  });
  if (taskPrimed) {
    Object.keys(current).forEach(function (id) {
      if (!taskKnownP0[id]) taskFreshP0[id] = true;
    });
  }
  Object.keys(taskFreshP0).forEach(function (id) {
    if (!current[id]) delete taskFreshP0[id];
  });
  taskKnownP0 = current;
  taskPrimed = true;
  var urgent = Object.keys(taskFreshP0).length > 0;
  document.getElementById("task-banner").hidden = !urgent;
  return urgent;
}

function taskCard(row) {
  var badges = (row.badges || []).map(function (badge) {
    return "<span class='chip'>" + escapeHtml(badge) + "</span>";
  }).join("");
  var busy = taskBusy[row.id] ? " disabled" : "";
  var note = taskNotices[row.id] ? "<p class='muted task-note'>" + escapeHtml(taskNotices[row.id]) + "</p>" : "";
  return "<article class='card'>" +
    "<h3>" + escapeHtml(row.countdown) + " · " + escapeHtml(row.shortPriority) + " · " + escapeHtml(row.title) + "</h3>" +
    "<p>" + escapeHtml(row.label) + " <span class='muted'>" + escapeHtml(row.status) + "</span></p>" +
    (row.reason ? "<p class='muted'>" + escapeHtml(row.reason) + "</p>" : "") +
    (badges ? "<p>" + badges + "</p>" : "") +
    "<p class='task-actions'>" +
    "<button type='button' data-act='open' data-id='" + row.id + "'" + busy + ">Open</button>" +
    "<button type='button' data-act='draft' data-id='" + row.id + "'" + busy + ">Draft</button>" +
    (row.otherBody ? "<button type='button' data-act='other' data-id='" + row.id + "'" + busy + ">Other time</button>" : "") +
    (row.declineBody ? "<button type='button' data-act='decline' data-id='" + row.id + "'" + busy + ">" + escapeHtml(row.declineLabel || "Decline") + "</button>" : "") +
    "<button type='button' data-act='done' data-id='" + row.id + "'" + busy + ">Done</button>" +
    "<button type='button' data-act='scam' data-id='" + row.id + "'" + busy + ">Scam</button>" +
    "</p>" + note + "</article>";
}

function taskAction(event) {
  var button = event.target.closest ? event.target.closest("button[data-act]") : null;
  if (!button || button.disabled) return;
  var id = Number(button.getAttribute("data-id"));
  var act = button.getAttribute("data-act");
  if (!id || taskBusy[id]) return;
  if (act === "scam" && !window.confirm("Mark this as a scam? Later mail for this apartment will stay out of the queue.")) return;
  taskBusy[id] = true;
  delete taskNotices[id];
  taskStamp = "";
  drawTasks(taskRows);
  fetch("/api/tasks/" + act, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: id })
  }).then(function (response) {
    if (!response.ok) {
      return response.text().then(function (text) { taskNotices[id] = text || "Could not update the task."; });
    }
    return response.json().then(function (body) {
      if (body.notice) taskNotices[id] = body.notice;
      if (body.url) {
        var opened = window.open(body.url, "_blank");
        if (opened) opened.opener = null;
        else taskNotices[id] = (body.notice ? body.notice + "\\n" : "") + body.url;
      }
      if (act === "decline") reloadFlow();
    });
  }).catch(function () {
    taskNotices[id] = "Could not update the task.";
  }).then(function () {
    delete taskBusy[id];
    taskStamp = "";
    pollTasks();
  });
}

function reloadFlow() {
  fetch("/api/flow").then(function (response) { return response.json(); }).then(function (data) {
    flow = data;
    draw(data);
    drawTable(data);
  });
}

function draw(data) {
  var host = document.getElementById("diagram");
  var closed = document.getElementById("closed-line");
  if (closed) {
    if (data.closed > 0) {
      closed.innerHTML = "<button type='button' id='closed-node' aria-pressed='false'>Closed<span>" + data.closed + "</span></button>";
      document.getElementById("closed-node").addEventListener("click", function () {
        writeStage(pinned === "closed" ? "" : "closed");
      });
    } else {
      closed.innerHTML = "";
    }
  }
  host.replaceChildren();
  if (!data.nodes.length) {
    host.textContent = data.closed > 0 ? "" : "No apartment progress yet.";
    syncPins();
    return;
  }
  var width = 960;
  var bar = 8;
  var spineTop = 56;
  var flowMax = 96;
  var present = data.nodes.filter(function (node) { return node.count > 0 || touches(data.links, node.id); });
  var presentIds = {};
  present.forEach(function (node) { presentIds[node.id] = node; });
  var maxFlow = 1;
  present.forEach(function (node) {
    maxFlow = Math.max(maxFlow, node.count, incoming(data.links, node.id), outgoing(data.links, node.id));
  });
  data.links.forEach(function (link) { maxFlow = Math.max(maxFlow, link.value); });
  function thick(value) {
    if (value <= 0) return 0;
    return flowMax * value / maxFlow;
  }
  var spineNodes = spineOrder.filter(function (id) { return presentIds[id]; }).map(function (id) { return presentIds[id]; });
  present.forEach(function (node) {
    if (!exitKind[node.id] && spineOrder.indexOf(node.id) < 0) spineNodes.push(node);
  });
  var links = data.links.slice();
  var layout = {};
  var count = spineNodes.length;
  var columnGap = 240;
  var span = count > 1 ? columnGap * (count - 1) : 0;
  var origin = (width - span) / 2;
  spineNodes.forEach(function (node, index) {
    var onward = links.filter(function (link) { return link.source === node.id && outcome(link.target) === "on"; });
    var onwardValue = (node.stock || 0) + onward.reduce(function (sum, link) { return sum + link.value; }, 0);
    var h = thick(node.count);
    var face = node.count > 0 ? h * onwardValue / node.count : h;
    var place = face >= 44 ? "mid" : "above";
    layout[node.id] = {
      x: origin + index * columnGap - bar / 2,
      y: spineTop,
      h: h,
      w: bar,
      kind: "on",
      place: place,
      labelY: place === "mid" ? spineTop + Math.min(face, h) / 2 : spineTop
    };
  });
  var exitNodes = exitOrder.filter(function (id) { return presentIds[id]; }).map(function (id) { return presentIds[id]; });
  var grouped = {};
  exitNodes.forEach(function (node) {
    var src = linkSource(links, node.id, layout) || (layout.discovered ? "discovered" : "");
    var key = src || "_";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(node);
  });
  var spineBottom = spineTop;
  spineNodes.forEach(function (node) {
    spineBottom = Math.max(spineBottom, layout[node.id].y + layout[node.id].h);
  });
  var lowerTop = spineBottom + 36;
  Object.keys(grouped).forEach(function (key) {
    var group = grouped[key];
    var gap = 20;
    var srcBox = layout[key];
    var srcIndex = -1;
    spineNodes.forEach(function (node, index) { if (node.id === key) srcIndex = index; });
    var next = srcIndex >= 0 && srcIndex < spineNodes.length - 1 ? layout[spineNodes[srcIndex + 1].id] : null;
    var x = srcBox ? srcBox.x + 110 : origin;
    if (srcBox && next) x = srcBox.x + Math.min(120, (next.x - srcBox.x) * 0.45);
    var y = lowerTop;
    group.forEach(function (node) {
      var h = thick(node.count);
      layout[node.id] = { x: x, y: y, h: h, w: bar, kind: outcome(node.id), place: "beside", labelY: y + h / 2 };
      y += h + gap;
    });
  });
  var bottom = spineTop;
  present.forEach(function (node) {
    if (layout[node.id]) bottom = Math.max(bottom, layout[node.id].y + layout[node.id].h);
  });
  var height = Math.ceil(bottom + 28);
  host.style.aspectRatio = width + " / " + height;
  var ordered = links.slice().sort(function (a, b) {
    var source = spineRank(a.source) - spineRank(b.source);
    if (source) return source;
    var kind = kindRank(a.target) - kindRank(b.target);
    if (kind) return kind;
    return exitOrder.indexOf(a.target) - exitOrder.indexOf(b.target);
  });
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("aria-hidden", "true");
  var outAt = {};
  var inAt = {};
  var segments = {};
  var onLinks = [];
  var exitLinks = [];
  ordered.forEach(function (link) {
    if (!layout[link.source] || !layout[link.target]) return;
    if (outcome(link.target) === "on") onLinks.push(link);
    else exitLinks.push(link);
  });
  function paintLink(link) {
    var source = layout[link.source];
    var target = layout[link.target];
    var kind = outcome(link.target);
    var size = thick(link.value);
    var sy = source.y + (outAt[link.source] || 0);
    var ty = target.y + (inAt[link.target] || 0);
    outAt[link.source] = (outAt[link.source] || 0) + size;
    inAt[link.target] = (inAt[link.target] || 0) + size;
    addSeg(segments, link.source, sy, size, kind);
    addSeg(segments, link.target, ty, size, kind);
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    var x1 = source.x + source.w;
    var x2 = target.x;
    path.setAttribute("d", bandPath(x1, sy, size, x2, ty, size, kind !== "on"));
    path.setAttribute("class", "band " + kind);
    path.dataset.source = link.source;
    path.dataset.target = link.target;
    svg.appendChild(path);
  }
  onLinks.forEach(paintLink);
  present.forEach(function (node) {
    var box = layout[node.id];
    if (!box || !(node.stock > 0)) return;
    var size = thick(node.stock);
    if (size <= 0.4) return;
    var y = box.y + (outAt[node.id] || 0);
    outAt[node.id] = (outAt[node.id] || 0) + size;
    addSeg(segments, node.id, y, size, box.kind);
  });
  exitLinks.forEach(paintLink);
  present.forEach(function (node) {
    var box = layout[node.id];
    if (!box) return;
    var parts = segments[node.id] || [];
    if (!parts.length) {
      appendJoin(svg, box.x, box.y, box.w, box.h, box.kind, node.id);
      return;
    }
    parts.forEach(function (seg) {
      appendJoin(svg, box.x, seg.y, box.w, seg.h, seg.kind, node.id);
    });
  });
  host.appendChild(svg);
  present.forEach(function (node) {
    var box = layout[node.id];
    if (!box) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "node " + box.kind + (box.place === "above" ? " above" : "") + (box.place === "mid" ? " mid" : "") + (box.place === "end" ? " end" : "");
    button.dataset.stage = node.id;
    var onBand = box.place === "above" || box.place === "mid";
    var anchorX = onBand ? box.x + box.w / 2 : box.x + (box.place === "end" ? 0 : box.w);
    var anchorY = box.labelY != null ? box.labelY : (onBand ? box.y : box.y + box.h / 2);
    button.style.left = (anchorX / width * 100) + "%";
    button.style.top = (anchorY / height * 100) + "%";
    button.innerHTML = escapeHtml(node.label) + " <span>" + node.count + "</span>";
    button.addEventListener("mouseenter", function () { if (!pinned) highlight(node.id); });
    button.addEventListener("mouseleave", function () { if (!pinned) highlight(pinned); });
    button.addEventListener("focus", function () { if (!pinned) highlight(node.id); });
    button.addEventListener("blur", function () { if (!pinned) highlight(""); });
    button.addEventListener("click", function () {
      writeStage(pinned === node.id ? "" : node.id);
    });
    host.appendChild(button);
  });
  syncPins();
}

function drawTable(data) {
  var table = document.getElementById("flow-table");
  var sources = [];
  data.links.forEach(function (link) { if (sources.indexOf(link.source) < 0) sources.push(link.source); });
  var targets = [];
  data.links.forEach(function (link) { if (targets.indexOf(link.target) < 0) targets.push(link.target); });
  var html = "<thead><tr><th>To</th>";
  sources.forEach(function (source) { html += "<th>" + label(source) + "</th>"; });
  html += "<th>Total</th></tr></thead><tbody>";
  targets.forEach(function (target) {
    var total = 0;
    html += "<tr><th>" + label(target) + "</th>";
    sources.forEach(function (source) {
      var value = 0;
      data.links.forEach(function (link) {
        if (link.source === source && link.target === target) value = link.value;
      });
      total += value;
      html += "<td>" + value + "</td>";
    });
    html += "<td>" + total + "</td></tr>";
  });
  html += "</tbody>";
  table.innerHTML = html;
}

function loadUnlinked() {
  var query = showHidden ? "?hidden=1" : "";
  fetch("/api/unlinked" + query).then(function (response) { return response.json(); }).then(drawUnlinked);
}

function drawUnlinked(data) {
  var list = document.getElementById("unlinked");
  var items = [];
  (data.mail || []).forEach(function (mail) {
    items.push(mailItem(mail, true));
  });
  (data.events || []).forEach(function (event) {
    items.push("<li>" + escapeHtml(event.title) + " <span class='muted'>" + escapeHtml(event.place || "") + " " + escapeHtml(event.start) + "</span></li>");
  });
  list.innerHTML = items.length ? items.join("") : "<li>None.</li>";
}

function stageFromUrl() {
  var stage = new URLSearchParams(location.search).get("stage") || "";
  return stageIds.indexOf(stage) >= 0 ? stage : "";
}

function apartmentFromUrl() {
  var id = location.hash.replace(/^#/, "");
  try { id = decodeURIComponent(id); } catch (error) { id = ""; }
  return /^\\d{6,}$/.test(id) ? id : "";
}

function applyFromUrl() {
  pinned = stageFromUrl();
  syncPins();
  showApartments(pinned);
}

function onHashChange() {
  var id = apartmentFromUrl();
  if (!id || document.getElementById(id)) {
    revealApartment();
    return;
  }
  showApartments(stageFromUrl());
}

function writeStage(stage) {
  var url = new URL(location.href);
  if (stage) url.searchParams.set("stage", stage);
  else url.searchParams.delete("stage");
  url.hash = "";
  history.pushState({}, "", url);
  pinned = stage;
  syncPins();
  showApartments(stage);
}

function syncPins() {
  document.querySelectorAll(".node").forEach(function (item) {
    item.setAttribute("aria-pressed", item.dataset.stage === pinned ? "true" : "false");
  });
  var closed = document.getElementById("closed-node");
  if (closed) closed.setAttribute("aria-pressed", pinned === "closed" ? "true" : "false");
  highlight(pinned === "closed" ? "" : pinned);
}

function showApartments(stage, settled) {
  var token = ++listToken;
  shown = stage;
  var path = stage ? "/api/apartments?stage=" + encodeURIComponent(stage) : "/api/apartments";
  fetch(path).then(function (response) { return response.json(); }).then(function (rows) {
    if (token !== listToken) return;
    var id = apartmentFromUrl();
    if (!settled && stage && id && !rows.some(function (row) { return row.scoutId === id; })) {
      var url = new URL(location.href);
      url.searchParams.delete("stage");
      history.replaceState({}, "", url);
      pinned = "";
      syncPins();
      showApartments("", true);
      return;
    }
    var list = document.getElementById("apartments");
    if (!rows.length) {
      var empty = stage === "closed" ? "None in this stage." : stage ? "None in this branch." : "No apartments.";
      list.innerHTML = "<p>" + empty + "</p>";
      return;
    }
    list.innerHTML = rows.map(function (row) { return renderCard(row, true); }).join("");
    revealApartment();
  });
}

function revealApartment() {
  document.querySelectorAll(".card.linked").forEach(function (card) { card.classList.remove("linked"); });
  var id = apartmentFromUrl();
  if (!id) return;
  var card = document.getElementById(id);
  if (!card) return;
  card.classList.add("linked");
  card.scrollIntoView({ block: "start" });
}

function renderCard(row, showStage) {
  var outcomeNames = {
    cancelled_by_us: "Cancelled by us",
    rejected: "Rejected",
    offer_declined: "Offer declined",
    withdrawn: "Withdrawn"
  };
  var outcomeLabel = outcomeNames[row.outcome] || "";
  var title = row.title || row.scoutId;
  var primary = [
    row.rooms ? trimNumber(row.rooms) + " rooms" : "",
    row.areaSqm ? trimNumber(row.areaSqm) + " m²" : "",
    row.priceCold ? trimNumber(row.priceCold) + " € cold" : "",
    row.priceWarm ? trimNumber(row.priceWarm) + " € warm" : "",
    row.extraCosts ? trimNumber(row.extraCosts) + " € extra" : ""
  ].filter(Boolean).join(" · ");
  var secondary = [
    row.floor ? "floor " + row.floor : "",
    row.deposit ? row.deposit + " deposit" : "",
    row.moveIn ? "from " + row.moveIn : "",
    row.energyClass ? "energy " + row.energyClass : ""
  ].filter(Boolean);
  var seen = seenSpan(row.discoveredAt);
  var secondaryHtml = "";
  if (secondary.length || seen) {
    secondaryHtml = "<p class='muted'>" + escapeHtml(secondary.join(" · ")) + (secondary.length && seen ? " · " : "") + seen + "</p>";
  }
  var empty = !row.title && !row.address && !row.priceCold && !row.priceWarm && !row.rooms && !row.areaSqm;
  var refresh = "";
  if (empty && row.refreshState === "queued") {
    refresh = "<p class='muted'>Waiting to read the expose.</p>";
  } else if (empty) {
    var failed = row.refreshState === "failed" && row.refreshDetail ? "<p class='muted'>" + escapeHtml(row.refreshDetail) + "</p>" : "";
    refresh = failed + "<p><button type='button' class='read-expose' data-scout='" + escapeHtml(row.scoutId) + "'>Read expose</button></p>";
  }
  var mails = (row.mails || []).map(function (mail) { return mailItem(mail, false); }).join("");
  var viewings = (row.viewings || []).map(function (event) {
    return "<li>" + escapeHtml(event.title || "Viewing") + " <span class='muted'>" + escapeHtml(event.place || "") + " " + escapeHtml(event.start) + "</span></li>";
  }).join("");
  return "<article class='card' id='" + escapeHtml(row.scoutId) + "'>" +
    (row.hasImage ? "<img class='preview' alt='' src='/api/apartments/image?id=" + encodeURIComponent(row.scoutId) + "'>" : "") +
    "<div class='listing'>" +
    "<h3><a href='#" + escapeHtml(row.scoutId) + "'>" + escapeHtml(title) + "</a></h3>" +
    (showStage ? "<p class='muted'>" + escapeHtml(stageNames[row.stage] || row.stage) + "</p>" : "") +
    (outcomeLabel ? "<p class='muted'>" + escapeHtml(outcomeLabel) + "</p>" : "") +
    (row.address ? "<p>" + escapeHtml(row.address) + "</p>" : "") +
    (primary ? "<p class='facts'>" + escapeHtml(primary) + "</p>" : "") +
    secondaryHtml +
    "</div>" +
    (row.description ? "<p class='muted'>" + escapeHtml(row.description) + "</p>" : "") +
    (row.opened ? "" : "<p class='muted'>The expose was not opened.</p>") +
    refresh +
    topicLine(row.topic) +
    "<p><a href='" + escapeHtml(row.url) + "' target='_blank' rel='noreferrer'>See source</a></p>" +
    (mails ? "<ul>" + mails + "</ul>" : "") +
    (viewings ? "<ul>" + viewings + "</ul>" : "") +
    "</article>";
}

function readExpose(event) {
  var button = event.target.closest ? event.target.closest("button.read-expose") : null;
  if (!button) return;
  button.disabled = true;
  var id = button.getAttribute("data-scout") || "";
  fetch("/api/apartments/refresh?id=" + encodeURIComponent(id), { method: "POST" }).then(function (response) {
    if (response.ok) {
      showApartments(shown);
      return;
    }
    return response.text().then(function (text) {
      button.disabled = false;
      button.insertAdjacentHTML("afterend", "<p class='muted'>" + escapeHtml(text) + "</p>");
    });
  });
}

function topicLine(topic) {
  if (!topic || !topic.topic) return "";
  var names = { documents: "Documents", viewing: "Viewing", contract: "Contract", general: "General" };
  var name = names[topic.topic] || topic.topic;
  var state = topic.relation === "close" ? "finished" : "still on this step";
  var count = Number(topic.count) || 0;
  return "<p class='muted'>" + escapeHtml(name) + " · " + count + (count === 1 ? " mail · " : " mails · ") + state + "</p>";
}

function mailItem(mail, linkable) {
  var tag = [mail.relation || "", mail.intent || ""].filter(Boolean).join(" · ");
  var chips = (mail.intents || []).map(function (code) {
    return "<span class='chip'>" + escapeHtml(code) + "</span>";
  }).join("");
  var flags = (mail.redFlags || []).join(", ");
  var bannerText = mail.riskLevel && mail.riskLevel !== "SAFE" ? mail.riskLevel + (flags ? ": " + flags : "") : flags;
  var banner = bannerText ? "<p class='banner'>" + escapeHtml(bannerText) + "</p>" : "";
  var reason = !linkable ? judgmentReason(mail) : "";
  var docs = (mail.documents || []).length ? "<p class='muted'>" + escapeHtml(mail.documents.join(", ")) + "</p>" : "";
  var slots = (mail.slots || []).length ? "<p class='muted'>" + escapeHtml(mail.slots.join("; ")) + "</p>" : "";
  var portal = "";
  if (mail.linkUrl) {
    portal = mail.linksAreText
      ? "<p>" + escapeHtml(mail.linkUrl) + "</p>"
      : "<p><a href='" + escapeHtml(mail.linkUrl) + "' target='_blank' rel='noreferrer'>" + escapeHtml(mail.linkHost || mail.linkUrl) + "</a></p>";
  }
  var clean = !linkable && mail.cleanText ? "<details class='mail-body'><summary>Show message</summary><p class='message'>" + escapeHtml(mail.cleanText) + "</p></details>" : "";
  var draft = mail.draft ? "<p class='draft'>" + escapeHtml(mail.draft) + "</p>" : "";
  var alt = mail.altDraft ? "<p class='draft'>" + escapeHtml(mail.altDraft) + "</p>" : "";
  var counter = mail.otherDraft ? "<p class='draft'>" + escapeHtml(mail.otherDraft) + "</p>" : "";
  var compose = mail.composeUrl ? "<p><a href='" + escapeHtml(mail.composeUrl) + "' target='_blank' rel='noreferrer'>Open reply in Gmail</a></p>" : "";
  var other = mail.altComposeUrl ? "<p><a href='" + escapeHtml(mail.altComposeUrl) + "' target='_blank' rel='noreferrer'>Decline in Gmail</a></p>" : "";
  var counterLink = mail.otherComposeUrl ? "<p><a href='" + escapeHtml(mail.otherComposeUrl) + "' target='_blank' rel='noreferrer'>Other time in Gmail</a></p>" : "";
  var form = linkable ? "<form class='link-mail' data-id='" + escapeHtml(mail.id) + "'><input name='scoutId' placeholder='Scout id' aria-label='Scout id'><button type='submit'>Link</button></form>" : "";
  var hide = linkable ? "<button type='button' class='hide-mail' data-id='" + escapeHtml(mail.id) + "' data-hidden='" + (mail.concealed ? "false" : "true") + "'>" + (mail.concealed ? "Unhide" : "Hide") + "</button>" : "";
  var judgment = linkable ? judgmentBlock(mail) : "";
  return "<li><a href='" + escapeHtml(mail.url) + "' target='_blank' rel='noreferrer'>" + escapeHtml(mail.subject) + "</a> <span class='muted'>" + escapeHtml(mail.from) + " · " + escapeHtml(mail.sentAt) + "</span>" +
    (tag ? "<div class='muted'>" + escapeHtml(tag) + "</div>" : "") +
    judgment +
    (chips ? "<div>" + chips + "</div>" : "") + banner + reason + docs + slots + portal + clean + draft + compose + counter + counterLink + alt + other + form + hide + "</li>";
}

function judgmentReason(mail) {
  var parts = [mail.judgmentBranch || "", mail.judgmentCitation || ""].filter(Boolean);
  if (!parts.length) return "";
  return "<p class='muted'>" + escapeHtml(parts.join(" · ")) + "</p>";
}

function hideMail(event) {
  var button = event.target.closest ? event.target.closest("button.hide-mail") : null;
  if (!button) return;
  button.disabled = true;
  fetch("/api/unlinked/hide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gmailId: button.getAttribute("data-id"), hidden: button.getAttribute("data-hidden") === "true" })
  }).then(function (response) {
    if (!response.ok) {
      button.disabled = false;
      return;
    }
    loadUnlinked();
  });
}

function judgmentBlock(mail) {
  if (!mail.read) return "<p class='muted'>Not read yet</p>";
  var chips = (mail.judgments || []).map(function (item) {
    var score = typeof item.confidence === "number" ? " " + item.confidence.toFixed(2) : "";
    return "<span class='chip'>" + escapeHtml(String(item.code) + score) + "</span>";
  }).join("");
  var summaries = (mail.judgments || []).map(function (item) { return item.summary || ""; }).filter(Boolean).join(" · ");
  var label = mail.relevance ? "<p class='muted'>" + escapeHtml(mail.relevance) + "</p>" : "";
  return label + (chips ? "<div>" + chips + "</div>" : "") + (summaries ? "<p class='muted'>" + escapeHtml(summaries) + "</p>" : "");
}

function linkMail(event) {
  var form = event.target;
  if (!form || !form.classList || !form.classList.contains("link-mail")) return;
  event.preventDefault();
  var previous = form.querySelector(".link-note");
  if (previous) previous.remove();
  fetch("/api/unlinked/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gmailId: form.getAttribute("data-id"), scoutId: form.scoutId.value.trim() })
  }).then(function (response) {
    if (!response.ok) {
      return response.text().then(function (text) {
        var note = document.createElement("p");
        note.className = "muted link-note";
        note.textContent = text;
        form.appendChild(note);
      });
    }
    return fetch("/api/flow").then(function (next) { return next.json(); }).then(function (data) {
      flow = data;
      draw(data);
      drawTable(data);
      showApartments(shown);
      loadUnlinked();
    });
  });
}

function seenSpan(iso) {
  if (!iso) return "";
  var date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  var shown = berlinClock(date);
  var today = berlinClock(new Date());
  var time = pad(shown.hour) + ":" + pad(shown.minute);
  var label = time;
  if (shown.year !== today.year || shown.month !== today.month || shown.day !== today.day) {
    label = shown.day + "." + shown.month + ".";
    if (shown.year !== today.year) label += shown.year;
    label += ", " + time;
  }
  var full = date.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  return "<span title='" + escapeHtml(full) + "'>Seen " + escapeHtml(label) + "</span>";
}

function berlinClock(date) {
  var values = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).forEach(function (part) {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  var hour = Number(values.hour);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(values.minute)
  };
}

function pad(value) {
  return value < 10 ? "0" + value : String(value);
}

function trimNumber(value) {
  var number = Number(value);
  return Number.isInteger(number) ? String(number) : String(number);
}

function outcome(id) {
  return exitKind[id] || "on";
}
function kindRank(id) {
  var kind = outcome(id);
  return kind === "on" ? 0 : kind === "off" ? 1 : 2;
}
function spineRank(id) {
  var index = spineOrder.indexOf(id);
  if (index >= 0) return index;
  var exit = exitOrder.indexOf(id);
  return exit >= 0 ? spineOrder.length + exit : spineOrder.length + exitOrder.length;
}
function linkSource(links, id, layout) {
  var best = "";
  var bestValue = -1;
  links.forEach(function (link) {
    if (link.target !== id || !layout[link.source]) return;
    if (link.value > bestValue) {
      best = link.source;
      bestValue = link.value;
    }
  });
  return best;
}
function bandPath(x1, sy, sh, x2, ty, th, drop) {
  if (!drop) {
    var mid = (x1 + x2) / 2;
    return "M " + x1 + " " + sy + " C " + mid + " " + sy + ", " + mid + " " + ty + ", " + x2 + " " + ty + " L " + x2 + " " + (ty + th) + " C " + mid + " " + (ty + th) + ", " + mid + " " + (sy + sh) + ", " + x1 + " " + (sy + sh) + " Z";
  }
  var lead = Math.max(28, (ty - sy) * 0.55);
  return "M " + x1 + " " + sy + " C " + x1 + " " + (sy + lead) + ", " + x2 + " " + (ty - 12) + ", " + x2 + " " + ty + " L " + x2 + " " + (ty + th) + " C " + x2 + " " + (ty + th - 12) + ", " + x1 + " " + (sy + sh + lead) + ", " + x1 + " " + (sy + sh) + " Z";
}
function addSeg(segments, id, y, h, kind) {
  if (h <= 0.4) return;
  if (!segments[id]) segments[id] = [];
  segments[id].push({ y: y, h: h, kind: kind });
}
function appendJoin(svg, x, y, w, h, kind, stage) {
  var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  rect.setAttribute("class", "join " + kind);
  rect.dataset.stage = stage;
  svg.appendChild(rect);
}
function highlight(id) {
  var keep = relatedIds(id);
  var active = Boolean(id);
  document.querySelectorAll(".band").forEach(function (path) {
    var touch = !active || keep[path.dataset.source] || keep[path.dataset.target];
    path.classList.toggle("dim", !touch);
  });
  document.querySelectorAll(".join").forEach(function (rect) {
    rect.classList.toggle("dim", active && !keep[rect.dataset.stage]);
  });
  document.querySelectorAll(".node").forEach(function (button) {
    button.classList.toggle("dim", active && !keep[button.dataset.stage]);
  });
  follow(id);
}

function childNodes(id) {
  return flow.nodes.filter(function (item) { return item.parent === id; }).sort(function (a, b) {
    return spineRank(a.id) - spineRank(b.id);
  });
}

function relatedIds(id) {
  var keep = {};
  if (!id) return keep;
  function addBranch(stage) {
    if (!stage || keep[stage]) return;
    keep[stage] = true;
    childNodes(stage).forEach(function (child) { addBranch(child.id); });
  }
  var cursor = id;
  var guard = 0;
  while (cursor && guard < 16) {
    addBranch(cursor);
    var node = nodeOf(cursor);
    var parent = node && node.parent;
    if (!parent) break;
    childNodes(parent).forEach(function (child) { addBranch(child.id); });
    cursor = parent;
    guard += 1;
  }
  return keep;
}

function follow(id) {
  var node = id ? nodeOf(id) : nodeOf("discovered");
  var host = document.getElementById("follow");
  if (!node) {
    host.textContent = "Green stays on the path, salmon has stopped, amber needs you.";
    return;
  }
  host.textContent = partitionSentence(node);
}

function partitionSentence(node) {
  var places = [];
  stockPlaces(node.id, places);
  var parts = [];
  places.forEach(function (place) {
    if (place.id === node.id) return;
    var name = place.label.toLowerCase();
    parts.push(hasOnward(place.id) ? place.stock + " still " + name : place.stock + " " + name);
  });
  if (node.stock > 0 && parts.length) parts.unshift(node.stock + " still here");
  var noun = node.count === 1 ? "apartment was " : "apartments were ";
  var sentence = node.count + " " + noun + node.label.toLowerCase();
  if (parts.length) sentence += ": " + parts.join(", ");
  return sentence + ".";
}

function stockPlaces(id, into) {
  var node = nodeOf(id);
  if (!node) return;
  if (node.stock > 0) into.push(node);
  childNodes(id).forEach(function (child) { stockPlaces(child.id, into); });
}

function hasOnward(id) {
  return childNodes(id).some(function (child) { return child.count > 0; });
}

function nodeOf(id) {
  var found = null;
  flow.nodes.forEach(function (item) {
    if (item.id === id) found = item;
  });
  return found;
}

function label(id) {
  var node = flow.nodes.filter(function (item) { return item.id === id; })[0];
  return node ? node.label : id;
}
function touches(links, id) {
  return links.some(function (link) { return link.source === id || link.target === id; });
}
function incoming(links, id) {
  return links.reduce(function (sum, link) { return sum + (link.target === id ? link.value : 0); }, 0);
}
function outgoing(links, id) {
  return links.reduce(function (sum, link) { return sum + (link.source === id ? link.value : 0); }, 0);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}
load();
</script>
</body>
</html>`;
}
