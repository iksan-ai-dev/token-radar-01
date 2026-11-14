// app.js — Token Radar dashboard. Classic script; reads window.RADAR
// (written by main.ts) and window.RadarFarm (farm.js). No network, no
// fetch: the page renders from the data baked in at build time.
// Row layout in RADAR.rows: [rank, slug, name, category, chains, tvl,
// change_7d, age_years, multiple, multiple_n, multiple_source, growth,
// ageF, breadth, quality, implied, tier]
(function () {
  var D = window.RADAR;
  var R = D.rows, M = D.meta;
  var I = { rank: 0, slug: 1, name: 2, cat: 3, chains: 4, tvl: 5, chg: 6, age: 7,
    mult: 8, multN: 9, multSrc: 10, growth: 11, ageF: 12, breadth: 13, qual: 14,
    value: 15, tier: 16 };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K"; return "$" + n; }
  function pct(v) { if (v == null) return "—";
    var c = v > 0 ? "up" : v < 0 ? "down" : "";
    return '<span class="' + c + '">' + (v > 0 ? "+" : "") + v.toFixed(1) + "%</span>"; }
  function rowObj(r) { return { name: r[I.name], category: r[I.cat], chains: r[I.chains], tvl_usd: r[I.tvl] }; }
  function firstStep(r) { return window.RadarFarm.farmStepsFor(rowObj(r))[0]; }
  function bySlug(slug) { for (var i = 0; i < R.length; i++) if (R[i][I.slug] === slug) return R[i]; return null; }

  // ---- header meta ----
  document.getElementById("meta").textContent =
    "Snapshot " + M.as_of + " · " + M.scanned + " protocols scanned · " +
    M.watchlist + " on the watchlist · " + M.ranked + " ranked · global median mcap/TVL " + M.global_multiple;

  // ---- filter controls ----
  var cats = {}, chains = {};
  R.forEach(function (r) { cats[r[I.cat] || "(no category)"] = 1; r[I.chains].forEach(function (c) { chains[c] = 1; }); });
  function fill(sel, obj) { Object.keys(obj).sort().forEach(function (k) {
    var o = document.createElement("option"); o.value = k; o.textContent = k; sel.appendChild(o); }); }
  fill(document.getElementById("cat"), cats);
  fill(document.getElementById("chain"), chains);

  var q = document.getElementById("q"), cat = document.getElementById("cat"),
    chain = document.getElementById("chain"), wl = document.getElementById("wl"),
    minTvl = document.getElementById("minTvl"), sort = document.getElementById("sort");
  var state = { q: "", cat: "", chain: "", wl: false, minTvl: 0, sort: "value" };

  function filtered() {
    var out = R.filter(function (r) {
      if (state.q) { var hay = (r[I.name] + " " + r[I.slug]).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) === -1) return false; }
      if (state.cat && (r[I.cat] || "(no category)") !== state.cat) return false;
      if (state.chain && r[I.chains].indexOf(state.chain) === -1) return false;
      if (state.wl && r[I.tier] !== 1) return false;
      if (r[I.tvl] < state.minTvl) return false;
      return true;
    });
    var k = state.sort;
    out.sort(function (a, b) {
      if (k === "tvl") return b[I.tvl] - a[I.tvl];
      if (k === "growth") return (b[I.chg] == null ? -1e9 : b[I.chg]) - (a[I.chg] == null ? -1e9 : a[I.chg]);
      if (k === "age") return (b[I.age] == null ? -1 : b[I.age]) - (a[I.age] == null ? -1 : a[I.age]);
      return a[I.rank] - b[I.rank];
    });
    return out;
  }

  function renderBoard() {
    var rows = filtered();
    var max = rows.length ? rows[0][I.value] : 1;
    var html = "";
    rows.forEach(function (r) {
      var badge = r[I.tier] === 1
        ? '<span class="badge">Watchlist</span>' : '<span class="badge below">Below floor</span>';
      var w = Math.max(2, Math.round(100 * r[I.value] / max));
      html += "<tr data-slug=\"" + esc(r[I.slug]) + "\"><td class=\"num\">" + r[I.rank] + "</td>" +
        "<td><b>" + esc(r[I.name]) + "</b>" + badge + "<br><span style=\"color:var(--mut);font-size:12px\">" + esc(r[I.slug]) + "</span></td>" +
        "<td>" + esc(r[I.cat] || "—") + "</td><td>" + esc(r[I.chains].slice(0, 3).join(", ")) + (r[I.chains].length > 3 ? " +" + (r[I.chains].length - 3) : "") + "</td>" +
        "<td class=\"num\">" + money(r[I.tvl]) + "</td><td class=\"num\">" + pct(r[I.chg]) + "</td>" +
        "<td class=\"num\">" + (r[I.age] == null ? "—" : r[I.age].toFixed(1) + "y") + "</td>" +
        "<td class=\"num\"><b>" + money(r[I.value]) + "</b><div class=\"bar\"><i style=\"width:" + w + "%\"></i></div></td>" +
        "<td class=\"farm\">" + esc(firstStep(r)) + "</td></tr>";
    });
    document.getElementById("rows").innerHTML = html;
    document.getElementById("count").textContent = rows.length + " of " + R.length + " shown";
    document.querySelectorAll("#rows tr").forEach(function (tr) {
      tr.addEventListener("click", function () { location.hash = "#/p/" + tr.getAttribute("data-slug"); });
    });
  }

  // ---- multiples table (methodology) ----
  (function () {
    var html = "";
    Object.keys(D.multiples).sort().forEach(function (c) {
      var m = D.multiples[c];
      html += "<tr><td>" + esc(c) + "</td><td class=\"num\">" + m[0].toFixed(3) + "</td><td class=\"num\">" + m[1] + "</td><td>" + (m[2] === 1 ? "category" : "global fallback") + "</td></tr>";
    });
    document.querySelector("#mults tbody").innerHTML = html;
  })();

  // ---- detail view ----
  function renderDetail(slug) {
    var r = bySlug(slug);
    var el = document.getElementById("detail");
    if (!r) { el.innerHTML = "<h2>Protocol not found</h2><p>No ranked protocol has the slug “" + esc(slug) + "”.</p>"; return; }
    var steps = window.RadarFarm.farmStepsFor(rowObj(r));
    var comps = D.comparables[r[I.cat] || "(no category)"] || [];
    var compHtml = comps.length ? comps.map(function (c) {
      return "<tr><td>" + esc(c.name) + "</td><td class=\"num\">" + c.ratio.toFixed(3) + "</td></tr>";
    }).join("") : "<tr><td colspan=\"2\">No tokened comparable in this category — the global median was used.</td></tr>";
    var notes = [];
    if (r[I.qual] < 1) notes.push("Quality 0.5×: a curator’s vaults belong to the underlying strategies, so a curator token would not capture their TVL.");
    if (r[I.multSrc] === 0) notes.push("Category multiple is the global fallback: fewer than 5 tokened comparables in “" + r[I.cat] + "” (n=" + r[I.multN] + ").");
    if (r[I.chg] == null) notes.push("No 7-day change was reported for this protocol, so growth is 1.00×.");
    if (r[I.age] == null) notes.push("No listing date was recorded, so age is 1.00×.");
    notes.push("“Records no token” is a DefiLlama record, not proof the protocol has no token.");
    el.innerHTML =
      "<h2>" + esc(r[I.name]) + " <span class=\"badge" + (r[I.tier] === 1 ? "" : " below") + "\">" + (r[I.tier] === 1 ? "Watchlist" : "Below floor") + " · rank #" + r[I.rank] + "</span></h2>" +
      "<p style=\"color:var(--mut)\">" + esc(r[I.slug]) + " · " + esc(r[I.cat] || "no category") + " · " + esc(r[I.chains].join(", ")) + "</p>" +
      "<div class=\"stats\">" +
      "<div class=\"stat\"><b>Implied value</b><span>" + money(r[I.value]) + "</span></div>" +
      "<div class=\"stat\"><b>TVL</b><span>" + money(r[I.tvl]) + "</span></div>" +
      "<div class=\"stat\"><b>7-day change</b><span>" + (r[I.chg] == null ? "—" : (r[I.chg] > 0 ? "+" : "") + r[I.chg].toFixed(1) + "%") + "</span></div>" +
      "<div class=\"stat\"><b>Age</b><span>" + (r[I.age] == null ? "—" : r[I.age].toFixed(1) + "y") + "</span></div>" +
      "<div class=\"stat\"><b>Category multiple</b><span>" + r[I.mult].toFixed(3) + "</span></div></div>" +
      "<h3>How this value is built</h3><div class=\"calc\">" +
      money(r[I.tvl]) + " TVL<br>× " + r[I.mult].toFixed(3) + " multiple (" + esc(r[I.cat] || "—") + ", " + r[I.multN] + " tokened comparables, " + (r[I.multSrc] === 1 ? "category" : "global fallback") + ")<br>" +
      "× " + r[I.growth].toFixed(2) + " growth (7d " + (r[I.chg] == null ? "n/a" : r[I.chg].toFixed(1) + "%") + ")<br>" +
      "× " + r[I.ageF].toFixed(2) + " age (" + (r[I.age] == null ? "unknown" : r[I.age].toFixed(1) + "y") + ")<br>" +
      "× " + r[I.breadth].toFixed(2) + " breadth (" + r[I.chains].length + " chain" + (r[I.chains].length === 1 ? "" : "s") + ")<br>" +
      "× " + r[I.qual].toFixed(2) + " quality<br><span class=\"eq\">= " + money(r[I.value]) + " implied value</span> (circulating-mcap equivalent; FDV would typically run 2–3× higher)</div>" +
      "<h3>Tokened comparables in “" + esc(r[I.cat] || "—") + "”</h3>" +
      "<table><thead><tr><th>Protocol</th><th>mcap / TVL</th></tr></thead><tbody>" + compHtml + "</tbody></table>" +
      "<h3>Farm plan — how to position for a launch</h3><ol class=\"steps\">" +
      steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
      "<p class=\"note\">" + notes.map(esc).join("<br>") + "</p>";
  }

  // ---- routing ----
  function route() {
    var h = location.hash || "#/board";
    var m = h.match(/^#\/p\/([A-Za-z0-9._-]+)/);
    if (m) {
      document.getElementById("boardView").hidden = true;
      document.getElementById("detailView").hidden = false;
      renderDetail(m[1]);
      window.scrollTo(0, 0);
      return;
    }
    document.getElementById("boardView").hidden = false;
    document.getElementById("detailView").hidden = true;
    var qm = h.match(/^#\/board\?(.*)/);
    if (qm) {
      var p = new URLSearchParams(qm[1]);
      if (p.get("cat")) { state.cat = p.get("cat"); cat.value = state.cat; }
      if (p.get("chain")) { state.chain = p.get("chain"); chain.value = state.chain; }
      if (p.get("wl")) { state.wl = p.get("wl") === "1"; wl.checked = true; }
      if (p.get("q")) { state.q = p.get("q"); q.value = state.q; }
      if (p.get("sort")) { state.sort = p.get("sort"); sort.value = state.sort; }
    }
    renderBoard();
  }

  // ---- events ----
  [q, cat, chain, minTvl, sort].forEach(function (el) {
    el.addEventListener("input", function () {
      state.q = q.value; state.cat = cat.value; state.chain = chain.value;
      state.minTvl = +minTvl.value; state.sort = sort.value; renderBoard();
    });
  });
  wl.addEventListener("change", function () { state.wl = wl.checked; renderBoard(); });
  document.querySelectorAll("#board th[data-k]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-k");
      state.sort = k === "value" ? "value" : k === "tvl" ? "tvl" : k === "growth" ? "growth" : k === "age" ? "age" : "value";
      sort.value = state.sort; renderBoard();
    });
  });
  window.addEventListener("hashchange", route);
  route();
})();
