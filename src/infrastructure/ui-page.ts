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
  .diagram { position: relative; width: min(960px, 100%); aspect-ratio: 960 / 440; height: auto; }
  .diagram svg { width: 100%; height: 100%; }
  .band { fill: var(--foreground); opacity: 0.28; transition: opacity 160ms ease; }
  .band.dim { opacity: 0.08; }
  .node {
    position: absolute; border: 1px solid var(--border); background: var(--card); color: var(--foreground);
    text-align: left; padding: 8px 10px; cursor: pointer; font: inherit;
  }
  .node.dim { opacity: 0.45; }
  .node[aria-pressed="true"] { outline: 2px solid var(--primary); }
  .node small { display: block; color: var(--muted); }
  table { border-collapse: collapse; width: min(960px, 100%); }
  th, td { border-bottom: 1px solid var(--border); text-align: left; padding: 6px 8px; }
  .flow-table { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); border: 0; }
  .tabs { display: flex; gap: 8px; margin: 8px 0 16px; }
  .tabs button { font: inherit; background: transparent; color: var(--foreground); border: 1px solid var(--border); padding: 6px 12px; cursor: pointer; border-radius: 6px; }
  .tabs button[aria-selected="true"] { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
  .cards { display: grid; gap: 12px; max-width: 720px; }
  .card { border: 1px solid var(--border); background: var(--card); border-radius: 8px; padding: 12px 14px; }
  .card h3 { margin: 0 0 6px; font-size: 1rem; }
  .card .preview { display: block; width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin: 0 0 8px; }
  .card button, .link-mail button { font: inherit; background: transparent; color: var(--foreground); border: 1px solid var(--border); padding: 6px 12px; cursor: pointer; border-radius: 6px; }
  .link-mail { display: flex; gap: 8px; align-items: center; margin: 6px 0 12px; flex-wrap: wrap; }
  .link-mail input { font: inherit; background: var(--background); color: var(--foreground); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
  .card p, .card ul { margin: 0 0 8px; }
  .muted, .card .muted { color: var(--muted); }
  a { color: var(--foreground); }
  .draft { white-space: pre-wrap; margin: 4px 0; }
  @media (max-width: 700px) {
    .diagram { display: none; }
    .flow-table { position: static; width: auto; height: auto; margin: 0 0 16px; overflow: visible; clip: auto; }
  }
  @media (prefers-reduced-motion: reduce) { .band, .switch span { transition: none; } }
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
  <button type="button" id="tab-other" role="tab" aria-selected="false" aria-controls="panel-other">Other</button>
</div>
<div id="panel-flow" role="tabpanel">
<p id="follow">Each band is apartments that moved from one stage to the next.</p>
<div class="diagram" id="diagram" dir="ltr"></div>
<table class="flow-table" id="flow-table"></table>
<h2>Apartments</h2>
<div class="cards" id="apartments"><p>Select a stage.</p></div>
</div>
<div id="panel-other" role="tabpanel" hidden>
<h2>Other</h2>
<p>Mail and events that are not attached to an apartment.</p>
<ul id="unlinked"></ul>
</div>
<script>
var pinned = "";
var shown = "";
var flow = { nodes: [], links: [] };
var columns = {
  discovered: 0,
  filtered_out: 1,
  manual: 1,
  failed: 1,
  applied: 1,
  in_conversation: 2,
  viewing_offered: 3,
  scheduled: 4
};

function load() {
  var themeSwitch = document.getElementById("theme-switch");
  themeSwitch.setAttribute("aria-checked", document.documentElement.classList.contains("dark") ? "true" : "false");
  themeSwitch.addEventListener("click", toggleTheme);
  document.getElementById("tab-flow").addEventListener("click", function () { selectTab("flow"); });
  document.getElementById("tab-other").addEventListener("click", function () { selectTab("other"); });
  fetch("/api/flow").then(function (response) { return response.json(); }).then(function (data) {
    flow = data;
    draw(data);
    drawTable(data);
  });
  fetch("/api/unlinked").then(function (response) { return response.json(); }).then(drawUnlinked);
  document.getElementById("apartments").addEventListener("click", readExpose);
  document.getElementById("unlinked").addEventListener("submit", linkMail);
}

function toggleTheme() {
  var dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("theme", dark ? "dark" : "light");
  document.getElementById("theme-switch").setAttribute("aria-checked", dark ? "true" : "false");
}

function selectTab(name) {
  var flowTab = name === "flow";
  document.getElementById("tab-flow").setAttribute("aria-selected", flowTab ? "true" : "false");
  document.getElementById("tab-other").setAttribute("aria-selected", flowTab ? "false" : "true");
  document.getElementById("panel-flow").hidden = !flowTab;
  document.getElementById("panel-other").hidden = flowTab;
}

function draw(data) {
  var host = document.getElementById("diagram");
  host.replaceChildren();
  if (!data.nodes.length) {
    host.textContent = "No apartment progress yet.";
    return;
  }
  var width = 960;
  var height = 440;
  var nodeWidth = 150;
  var present = data.nodes.filter(function (node) { return node.count > 0 || touches(data.links, node.id); });
  var grouped = [[], [], [], [], []];
  present.forEach(function (node) { grouped[columns[node.id]].push(node); });
  var weights = {};
  present.forEach(function (node) {
    weights[node.id] = Math.max(node.count, incoming(data.links, node.id), outgoing(data.links, node.id), 1);
  });
  var layout = {};
  grouped.forEach(function (group, index) {
    if (!group.length) return;
    var total = group.reduce(function (sum, node) { return sum + weights[node.id]; }, 0);
    var gap = 10;
    var inner = height - 24 - gap * (group.length - 1);
    var y = 12;
    group.forEach(function (node) {
      var h = Math.max(36, inner * (weights[node.id] / total));
      layout[node.id] = { x: 12 + index * ((width - 24 - nodeWidth) / 4), y: y, h: h, w: nodeWidth };
      y += h + gap;
    });
  });
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("aria-hidden", "true");
  var outAt = {};
  var inAt = {};
  data.links.forEach(function (link) {
    var source = layout[link.source];
    var target = layout[link.target];
    if (!source || !target) return;
    var sh = source.h * (link.value / weights[link.source]);
    var th = target.h * (link.value / weights[link.target]);
    var sy = source.y + (outAt[link.source] || 0);
    var ty = target.y + (inAt[link.target] || 0);
    outAt[link.source] = (outAt[link.source] || 0) + sh;
    inAt[link.target] = (inAt[link.target] || 0) + th;
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    var x1 = source.x + source.w;
    var x2 = target.x;
    var mid = (x1 + x2) / 2;
    path.setAttribute("d", "M " + x1 + " " + sy + " C " + mid + " " + sy + ", " + mid + " " + ty + ", " + x2 + " " + ty + " L " + x2 + " " + (ty + th) + " C " + mid + " " + (ty + th) + ", " + mid + " " + (sy + sh) + ", " + x1 + " " + (sy + sh) + " Z");
    path.setAttribute("class", "band");
    path.dataset.source = link.source;
    path.dataset.target = link.target;
    svg.appendChild(path);
  });
  host.appendChild(svg);
  present.forEach(function (node) {
    var box = layout[node.id];
    var button = document.createElement("button");
    button.type = "button";
    button.className = "node";
    button.dataset.stage = node.id;
    button.style.left = (box.x / width * 100) + "%";
    button.style.top = (box.y / height * 100) + "%";
    button.style.width = (box.w / width * 100) + "%";
    button.style.height = (box.h / height * 100) + "%";
    button.innerHTML = node.label + "<small>" + node.count + "</small>";
    button.addEventListener("mouseenter", function () { if (!pinned) highlight(node.id); });
    button.addEventListener("mouseleave", function () { if (!pinned) highlight(pinned); });
    button.addEventListener("focus", function () { if (!pinned) highlight(node.id); });
    button.addEventListener("blur", function () { if (!pinned) highlight(""); });
    button.addEventListener("click", function () {
      pinned = pinned === node.id ? "" : node.id;
      document.querySelectorAll(".node").forEach(function (item) {
        item.setAttribute("aria-pressed", item.dataset.stage === pinned ? "true" : "false");
      });
      highlight(pinned);
      follow(node.id);
      if (pinned) showApartments(node.id);
    });
    host.appendChild(button);
  });
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

function showApartments(stage) {
  shown = stage;
  fetch("/api/apartments?stage=" + encodeURIComponent(stage)).then(function (response) { return response.json(); }).then(function (rows) {
    var list = document.getElementById("apartments");
    if (!rows.length) {
      list.innerHTML = "<p>None in this stage.</p>";
      return;
    }
    list.innerHTML = rows.map(renderCard).join("");
  });
}

function renderCard(row) {
  var title = row.title || row.scoutId;
  var facts = [
    row.rooms ? trimNumber(row.rooms) + " rooms" : "",
    row.areaSqm ? trimNumber(row.areaSqm) + " m²" : "",
    row.priceCold ? trimNumber(row.priceCold) + " cold" : "",
    row.priceWarm ? trimNumber(row.priceWarm) + " warm" : "",
    row.extraCosts ? trimNumber(row.extraCosts) + " extra" : "",
    row.deposit ? row.deposit + " deposit" : "",
    row.floor ? "floor " + row.floor : "",
    row.moveIn ? "from " + row.moveIn : "",
    row.energyClass ? "energy " + row.energyClass : ""
  ].filter(Boolean).join(" · ");
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
  return "<article class='card'>" +
    (row.hasImage ? "<img class='preview' alt='' src='/api/apartments/image?id=" + encodeURIComponent(row.scoutId) + "'>" : "") +
    "<h3>" + escapeHtml(title) + "</h3>" +
    seenLine(row.discoveredAt) +
    (row.address ? "<p>" + escapeHtml(row.address) + "</p>" : "") +
    (facts ? "<p>" + escapeHtml(facts) + "</p>" : "") +
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
      if (shown) showApartments(shown);
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
  var clean = !linkable && mail.cleanText ? "<p>" + escapeHtml(mail.cleanText) + "</p>" : "";
  var draft = mail.draft ? "<p class='draft'>" + escapeHtml(mail.draft) + "</p>" : "";
  var alt = mail.altDraft ? "<p class='draft'>" + escapeHtml(mail.altDraft) + "</p>" : "";
  var compose = mail.composeUrl ? "<p><a href='" + escapeHtml(mail.composeUrl) + "' target='_blank' rel='noreferrer'>Open reply in Gmail</a></p>" : "";
  var other = mail.altComposeUrl ? "<p><a href='" + escapeHtml(mail.altComposeUrl) + "' target='_blank' rel='noreferrer'>Other reply in Gmail</a></p>" : "";
  var form = linkable ? "<form class='link-mail' data-id='" + escapeHtml(mail.id) + "'><input name='scoutId' placeholder='Scout id' aria-label='Scout id'><button type='submit'>Link</button></form>" : "";
  return "<li><a href='" + escapeHtml(mail.url) + "' target='_blank' rel='noreferrer'>" + escapeHtml(mail.subject) + "</a> <span class='muted'>" + escapeHtml(mail.from) + " · " + escapeHtml(mail.sentAt) + "</span>" +
    (tag ? "<div class='muted'>" + escapeHtml(tag) + "</div>" : "") + clean + draft + compose + alt + other + form + "</li>";
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
      if (shown) showApartments(shown);
      return fetch("/api/unlinked").then(function (unlinked) { return unlinked.json(); }).then(drawUnlinked);
    });
  });
}

function seenLine(iso) {
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
  return "<p class='muted' title='" + escapeHtml(full) + "'>Seen " + escapeHtml(label) + "</p>";
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

function highlight(id) {
  document.querySelectorAll(".band").forEach(function (path) {
    var touch = !id || path.dataset.source === id || path.dataset.target === id;
    path.classList.toggle("dim", !touch);
  });
  document.querySelectorAll(".node").forEach(function (button) {
    button.classList.toggle("dim", Boolean(id) && button.dataset.stage !== id);
  });
  if (id) follow(id);
  else document.getElementById("follow").textContent = "Each band is apartments that moved from one stage to the next.";
}

function follow(id) {
  var sent = flow.links.filter(function (link) { return link.source === id; });
  var received = flow.links.filter(function (link) { return link.target === id; });
  var sentence = label(id);
  if (sent.length) {
    sentence += " sends " + sent.map(function (link) { return link.value + " to " + label(link.target); }).join(", ");
  }
  if (received.length) {
    sentence += (sent.length ? " and" : "") + " receives " + received.map(function (link) { return link.value + " from " + label(link.source); }).join(", ");
  }
  if (!sent.length && !received.length) {
    sentence += " has no recorded moves";
  }
  document.getElementById("follow").textContent = sentence + ".";
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
