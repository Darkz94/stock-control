"use strict";
/* Stock Control — user interface.
 *
 * Works with either backend:
 *   - local prototype (backend-local.js): one browser, no login, localStorage only;
 *   - Firebase (backend-firebase.mjs): signed-in staff, shared Firestore data, server-confirmed changes.
 * Choose the backend in config.js. Never put API keys, phone numbers or real customer data in this repository.
 */
const D = window.StockDomain;
const { PRODUCTS, CONVERSIONS, STATUSES, parseWhatsApp, whatsappPhone, formatLabel, product } = D;

let backend = null;
let session = { mode: "local", authState: "loading", connection: "local", user: null, pending: [], users: [], error: "" };
let data = { counts: Object.fromEntries(PRODUCTS.map((p) => [p.id, 0])), tickets: [], movements: [], settings: { company: "Stock Control", lowThreshold: 2 } };

const DEVICE_KEY = "stock_control_device_v1";
const device = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_KEY) || "null");
    return v && typeof v === "object" ? v : { ownWhatsApp: "" };
  } catch (_) {
    return { ownWhatsApp: "" };
  }
})();
function saveDevice() {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  } catch (_) {
    /* private mode / storage blocked: preference lasts for this session only */
  }
}

const ui = {
  view: "dashboard",
  category: "All products",
  search: "",
  ticketFilter: "All",
  modal: null, // { type: "ticket", id } while a ticket detail is open, so live updates can refresh it
  draftLines: [],
  unmatched: [],
  captureMeta: { manager: "", phone: "", site: "" },
  busy: false,
  legacyPreview: null,
  legacyBackup: null,
};

const img = (id) => "./assets/" + (product(id)?.img || "");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[s]);
const dateFmt = (iso) => (iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const qty = (id) => Number(data.counts[id] || 0);
const statusBadge = (s) => `<span class="pill ${esc(s)}">${esc(STATUSES[s] || s)}</span>`;
const title = (eyebrow, heading, description, buttons = "") =>
  `<div class="page-title"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(heading)}</h1><p class="subtitle">${esc(description)}</p></div><div class="actions">${buttons}</div></div>`;
const btn = (text, action, style = "primary", extra = "") => `<button type="button" class="btn ${style}" data-action="${esc(action)}" ${extra}>${text}</button>`;

const isShared = () => session.mode === "firebase";
const role = () => session.user?.role || (isShared() ? "" : "admin");
const isStaff = () => ["admin", "stock-controller"].includes(role());
const isAdmin = () => role() === "admin";
const signedInReady = () => !isShared() || session.authState === "ready";
const offline = () => isShared() && session.connection === "offline";
const ROLE_LABELS = { admin: "Admin", "stock-controller": "Stock controller" };

function notify(message, error = false) {
  const host = document.querySelector("#toast-host");
  host.innerHTML = `<div class="toast ${error ? "error" : ""}">${esc(message)}</div>`;
  window.clearTimeout(notify._timer);
  notify._timer = setTimeout(() => (host.innerHTML = ""), error ? 6500 : 3900);
}

/** Run a backend change. Disables the triggering control, shows "Saving…", and reports success only
 * after the backend has confirmed it. Returns the result, or undefined on failure. */
async function run(trigger, work, success) {
  if (ui.busy) {
    notify("Still saving the previous change…", true);
    return undefined;
  }
  ui.busy = true;
  const controls = trigger ? [trigger, ...(trigger.closest?.("form, .modal")?.querySelectorAll("button[type=submit]") || [])] : [];
  const labels = controls.map((c) => [c, c.innerHTML, c.disabled]);
  const relabel = (c) => c.tagName === "BUTTON" && (c === trigger || c.type === "submit");
  controls.forEach((c) => {
    c.disabled = true;
    if (relabel(c)) c.innerHTML = "Saving…";
  });
  try {
    const result = await work();
    if (success) notify(typeof success === "function" ? success(result) : success);
    return result;
  } catch (e) {
    notify(e?.message || "Something went wrong. Nothing was saved.", true);
    console.error(e);
    return undefined;
  } finally {
    ui.busy = false;
    labels.forEach(([c, html, dis]) => {
      if (c.isConnected) {
        if (relabel(c)) c.innerHTML = html;
        c.disabled = dis;
      }
    });
  }
}

// ---------------------------------------------------------------- views
function sharedNotice() {
  if (!isShared())
    return `<div class="notice"><strong>Local prototype mode</strong>Orders and stock are saved in this browser only. Managers cannot see the same live stock yet. Export backups regularly, and do not enter sensitive information until a secure shared backend is connected.</div>`;
  if (offline())
    return `<div class="notice warning"><strong>Offline — showing the last synced data</strong>Stock and ticket changes are disabled until you reconnect. Pasted WhatsApp orders are kept on this device and become tickets when you are back online.</div>`;
  return `<div class="notice"><strong>Shared database</strong>Signed in as ${esc(session.user?.displayName || "")} (${esc(ROLE_LABELS[role()] || role())}). Changes sync to every signed-in device and only show as saved once the server confirms them.</div>`;
}

function dashboard() {
  const pending = data.tickets.filter((t) => ["review", "new", "preparing"].includes(t.status));
  const ready = data.tickets.filter((t) => t.status === "ready");
  const low = PRODUCTS.filter((p) => qty(p.id) <= data.settings.lowThreshold);
  return (
    title("OPERATIONS OVERVIEW", "Your stock, at a glance", "Keep supplies organised and manager requests moving.", btn("＋ New order ticket", "new-order") + btn("＋ Receive stock", "stock-receive", "")) +
    `<div class="stats-grid"><div class="stat top"><div class="stat-top">Product variants <span class="stat-icon">▦</span></div><div class="stat-number">${PRODUCTS.length}</div><div class="stat-bottom">Cleaning, garden & maintenance</div></div><div class="stat"><div class="stat-top">Open requests <span class="stat-icon">☷</span></div><div class="stat-number">${pending.length}</div><div class="stat-bottom">New and being prepared</div></div><div class="stat"><div class="stat-top">Ready to collect <span class="stat-icon">✓</span></div><div class="stat-number">${ready.length}</div><div class="stat-bottom">Awaiting handover</div></div><div class="stat"><div class="stat-top">Low / zero stock <span class="stat-icon">!</span></div><div class="stat-number">${low.length}</div><div class="stat-bottom">At or below alert threshold</div></div></div>` +
    `<div class="two-columns"><section class="panel"><div class="panel-heading"><div><h2>Recent order tickets</h2><div class="panel-sub">Track requests from creation through collection</div></div><button class="heading-link btn tiny" data-view="orders">All tickets →</button></div>${data.tickets.length ? `<div class="ticket-list">${data.tickets.slice(0, 5).map(ticketRow).join("")}</div>` : `<div class="empty-state"><span class="empty-illustration">☷</span>No orders yet. Create your first manager request to open a ticket.</div>`}</section>
 <aside><section class="panel"><div class="panel-heading"><div><h2>Quick actions</h2><div class="panel-sub">Common stock operations</div></div></div><div class="quick-actions"><button class="quick-action" data-action="new-order"><span>☷</span>New ticket</button><button class="quick-action" data-action="stock-receive"><span>＋</span>Receive stock</button><button class="quick-action" data-view="transfers"><span>⇄</span>Convert packs</button><button class="quick-action" data-view="activity"><span>◷</span>Stock history</button></div></section><div style="height:17px"></div>${sharedNotice()}</aside></div>`
  );
}
function ticketRow(t) {
  return `<button class="ticket-row" style="width:100%;background:white;text-align:left" data-action="ticket-detail" data-id="${esc(t.id)}"><div><div class="ticket-row-title">${esc(t.id)} · ${esc(t.manager)}</div><div class="ticket-row-meta">${esc(t.site || "No location")} · ${t.lines.reduce((n, l) => n + l.quantity, 0)} units · ${esc(dateFmt(t.createdAt))}${t.pendingWrite ? " · syncing…" : ""}</div></div><div class="ticket-row-right">${statusBadge(t.status)}<span style="color:#91a79b">›</span></div></button>`;
}
function inventory() {
  const categories = ["All products", "Chemicals & liquids", "Garden consumables", "Cleaning supplies", "Tools & equipment"];
  const filtered = PRODUCTS.filter((p) => (ui.category === "All products" || ui.category === p.group) && `${p.name} ${p.size}`.toLowerCase().includes(ui.search.toLowerCase()));
  return (
    title("STOCK CATALOGUE", "Inventory", "Each pack size is tracked separately so your stock counts stay accurate.", btn("＋ Receive stock", "stock-receive") + btn("↓ Export stock CSV", "export-stock", "")) +
    `<div class="toolbar"><div class="searchbox"><span>⌕</span><input id="inventory-search" placeholder="Search products or pack sizes..." autocomplete="off" value="${esc(ui.search)}" aria-label="Search inventory" /></div><span class="subtitle">${filtered.length} products</span></div>
 <div class="filters">${categories.map((c) => `<button class="filter ${ui.category === c ? "active" : ""}" data-action="category" data-category="${esc(c)}">${esc(c)}</button>`).join("")}</div><div class="product-grid" id="product-grid">${filtered.map(productCard).join("")}</div>${filtered.length ? "" : '<div class="empty-state">No products match this search.</div>'}`
  );
}
function productCard(p) {
  const n = qty(p.id);
  return `<article class="product"><div class="product-image"><span class="category-tag">${esc(p.group)}</span><img src="${esc(img(p.id))}" alt="${esc(formatLabel(p))}" loading="lazy" /></div><div class="product-info"><div class="product-title">${esc(p.name)}</div><div class="product-variant">${esc(p.size)}</div><div class="product-footer"><div class="stock-qty ${n <= data.settings.lowThreshold ? "stock-low" : ""}">${n}<small>${esc(p.unit)}</small></div><button class="btn tiny" data-action="adjust-stock" data-id="${esc(p.id)}">Adjust</button></div></div></article>`;
}
function pendingPanel() {
  if (!isShared() || !session.pending.length) return "";
  return `<section class="panel" style="padding:20px;margin-bottom:17px"><div class="panel-heading"><div><h2>⏳ Waiting to sync (${session.pending.length})</h2><p class="panel-sub">Saved on this device only — these are NOT tickets yet. They are submitted automatically when the connection returns.</p></div>${btn("Retry now", "retry-pending", "tiny")}</div>${session.pending
    .map(
      (p) =>
        `<div class="mini-card"><strong>${esc(p.manager || D.MANAGER_PLACEHOLDER)} · ${esc(dateFmt(p.at))}</strong>${esc(String(p.message).split("\n").slice(0, 3).join(" / ").slice(0, 160))}${p.error ? `<br/><span style="color:var(--red)">Last attempt: ${esc(p.error)}</span>` : ""}<div class="actions" style="margin-top:8px">${btn("Discard", "discard-pending", "tiny danger", `data-id="${esc(p.requestId)}"`)}</div></div>`,
    )
    .join("")}</section>`;
}
function orders() {
  const tks = ui.ticketFilter === "All" ? data.tickets : data.tickets.filter((t) => t.status === ui.ticketFilter);
  const table = `<div class="filters">${["All", "review", "new", "preparing", "ready", "collected", "cancelled"].map((st) => `<button data-action="ticket-filter" data-status="${st}" class="filter ${ui.ticketFilter === st ? "active" : ""}">${st === "All" ? "All tickets" : STATUSES[st]} (${st === "All" ? data.tickets.length : data.tickets.filter((t) => t.status === st).length})</button>`).join("")}</div>
 <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Ticket</th><th>Manager / site</th><th>Items</th><th>Created</th><th>Status</th><th></th></tr></thead><tbody>${tks.map((t) => `<tr><td><strong>${esc(t.id)}</strong>${t.pendingWrite ? '<span class="small-muted">syncing…</span>' : ""}</td><td><strong>${esc(t.manager)}</strong><span class="small-muted">${esc(t.site || "No site supplied")}</span></td><td>${t.lines.length} products</td><td>${esc(dateFmt(t.createdAt))}</td><td>${statusBadge(t.status)}</td><td><button class="btn tiny" data-action="ticket-detail" data-id="${esc(t.id)}">View ›</button></td></tr>`).join("")}</tbody></table></div>${!tks.length ? '<div class="empty-state">No tickets in this category.</div>' : ""}</section>`;
  return (
    title("MANAGER REQUESTS", "Order tickets", "Paste a normal WhatsApp message and a ticket is created immediately.", btn("＋ Manual order", "new-order")) +
    `<section class="panel" style="padding:20px;margin-bottom:17px">
  <div class="panel-heading"><div><h2>⚡ Quick WhatsApp Paste</h2><p class="panel-sub">One paste = one saved ticket. No Create Ticket button required.</p></div></div>
  <div class="notice"><strong>Normal WhatsApp only</strong>Copy the manager’s order from WhatsApp. Pasting below instantly creates a numbered ticket marked <strong>Needs review</strong>. Check the products and manager before preparing stock. No chat access or automatic messages.</div>
  <div class="form-grid" style="margin-top:15px">
   <div class="field"><label for="quick-manager">Manager name (optional before pasting)</label><input id="quick-manager" maxlength="100" placeholder="e.g. Thabo" value="${esc(ui.captureMeta.manager)}" /></div>
   <div class="field"><label for="quick-phone">Manager WhatsApp number (optional)</label><input id="quick-phone" inputmode="tel" placeholder="e.g. 082 123 4567" value="${esc(ui.captureMeta.phone)}" /></div>
   <div class="field full"><label for="quick-site">Site / property (optional)</label><input id="quick-site" maxlength="120" placeholder="e.g. Complex A" value="${esc(ui.captureMeta.site)}" /></div>
  </div>
  <div class="field"><label for="quick-paste-message">Paste WhatsApp order here — creates ticket instantly</label>
  <textarea id="quick-paste-message" rows="5" placeholder="2 x Pine Gel 5L&#10;4 x Two-Stroke Oil 500ml&#10;3 x Black Bags" aria-describedby="quick-paste-help"></textarea>
  <small id="quick-paste-help">If your phone inserts text without triggering a Paste event, use the backup button below.</small></div>
  ${btn("Save typed text as ticket", "quick-capture", "dark")}
 </section>${pendingPanel()}` +
    table
  );
}

function transfers() {
  return (
    title("PACK SIZE CONVERSIONS", "Stock conversions", "Record stock moving from larger containers into smaller product sizes.", btn("⇄ Record conversion", "new-transfer")) +
    `<div class="notice warning"><strong>Important safety note</strong>This screen records inventory conversions; it is not a procedure for physically handling or repackaging chemicals. Follow product labels, applicable safety procedures and required container labelling.</div><div style="height:18px"></div><div class="product-grid">${CONVERSIONS.map((c) => {
      const a = product(c.source),
        b = product(c.target);
      return `<section class="panel" style="padding:14px"><div style="display:flex;align-items:center;gap:8px"><img src="${esc(img(a.id))}" alt="" style="width:38%;max-height:100px;object-fit:contain" /><span style="font-size:23px;color:var(--accent)">→</span><img src="${esc(img(b.id))}" alt="" style="width:38%;max-height:100px;object-fit:contain" /></div><strong style="font-size:13px">${esc(a.name)}</strong><p class="small-muted">1 × ${esc(a.size)} = ${c.ratio} × ${esc(b.size)}</p><p class="small-muted">Available bulk: ${qty(a.id)} · Small: ${qty(b.id)}</p><button class="btn tiny" data-action="new-transfer" data-source="${esc(a.id)}" style="margin-top:13px">Convert stock</button></section>`;
    }).join("")}</div>`
  );
}
function activity() {
  return (
    title("AUDIT TRAIL", "Stock movement history", "Every received, adjusted, converted and collected item is recorded.", btn("↓ Export history CSV", "export-history", "")) +
    `<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Product</th><th>Movement</th><th>Reason / ticket</th></tr></thead><tbody>${data.movements.map((m) => `<tr><td>${esc(dateFmt(m.at))}</td><td><strong>${esc(product(m.productId)?.name || m.productId)}</strong><span class="small-muted">${esc(product(m.productId)?.size || "")}</span></td><td><span class="activity-badge ${m.change < 0 ? "out" : ""}">${m.change > 0 ? "+" : ""}${esc(m.change)} ${esc(product(m.productId)?.unit || "")}</span><span class="small-muted">${esc(m.kind || "")}</span></td><td>${esc(m.reason)}${m.ticketId ? `<span class="small-muted">${esc(m.ticketId)}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>${!data.movements.length ? '<div class="empty-state">No stock movements recorded yet.</div>' : ""}${isShared() && data.movements.length >= 300 ? '<p class="footer-note">Showing the latest movements. Older history stays in the database.</p>' : ""}</section>`
  );
}
function settings() {
  const readOnly = isShared() && !isAdmin();
  const business = `<section class="panel"><div class="panel-heading"><h2>Business details</h2></div><form id="settings-form"><div class="field"><label for="company">Business / department name</label><input id="company" value="${esc(data.settings.company)}" maxlength="90" required ${readOnly ? "disabled" : ""} /></div><div class="field"><label for="business-number">My regular WhatsApp number (optional)</label><input id="business-number" value="${esc(device.ownWhatsApp)}" placeholder="e.g. +27 82 123 4567" inputmode="tel" /><small>Saved on this device only. Used only to open a prefilled WhatsApp chat for your own ticket copy; no Business account or API is needed. You must tap Send manually.</small></div><div class="field"><label for="low-threshold">Low stock alert at or below</label><input id="low-threshold" type="number" min="0" max="99999" step="1" value="${data.settings.lowThreshold}" required ${readOnly ? "disabled" : ""} /></div>${readOnly ? '<p class="footer-note">Only an admin can change the shared business name and alert level.</p>' : ""}<button class="btn primary" type="submit">Save settings</button></form></section>`;
  if (!isShared()) {
    return (
      title("PREFERENCES & DATA", "Settings & backups", "Use your normal WhatsApp number and safeguard your local records.") +
      `<div class="settings-grid">${business}
 <section class="panel"><div class="panel-heading"><h2>Backup & reporting</h2></div><p class="subtitle">Because this version saves to one browser, a downloaded backup is essential. Importing a backup replaces all local records.</p><div class="layout-stack" style="margin-top:22px">${btn("↓ Download full JSON backup", "export-backup", "dark")}${btn("↑ Restore a JSON backup", "import-backup", "")}${btn("↓ Export ticket CSV", "export-orders", "")}${btn("↓ Export stock CSV", "export-stock", "")}</div></section></div><div style="height:18px"></div><div class="notice warning"><strong>Before daily business use</strong>This public prototype has no staff sign-in or secure shared database. Ordinary WhatsApp cannot automatically import orders or send replies. The WhatsApp buttons only prepare messages for a person to check and send. Make the production app private and add authentication and server-side permissions before storing real manager phone numbers or deploying to a team.</div>`
    );
  }
  const needsSetup = session.balancesExists === false || session.settingsExists === false || session.conversionsExists === false;
  return (
    title("PREFERENCES & DATA", "Settings & team", "Shared settings, staff access and reports for the shared database.") +
    (isAdmin() && needsSetup
      ? `<div class="notice warning" style="margin-bottom:18px"><strong>First-time setup needed</strong>The shared stock record, settings or pack conversions have not been created in this Firebase project yet. This creates them with zero stock; it never overwrites existing data.<div class="actions" style="margin-top:10px">${btn("Run first-time setup", "init-db", "dark")}</div></div>`
      : "") +
    `<div class="settings-grid">${business}
 <section class="panel"><div class="panel-heading"><h2>Reports</h2></div><p class="subtitle">Exports contain what is loaded on this screen. Shared records are backed up by Firebase; there is no restore button, so data cannot be overwritten from a file.</p><div class="layout-stack" style="margin-top:22px">${btn("↓ Export ticket CSV", "export-orders", "")}${btn("↓ Export stock CSV", "export-stock", "")}${btn("↓ Export history CSV", "export-history", "")}${btn("↓ Download JSON snapshot", "export-backup", "")}</div>${isAdmin() ? `<div style="height:16px"></div><div class="notice"><strong>Move data from the local prototype</strong>Choose a JSON backup downloaded from the old single-device version. You will see exactly what will be imported before anything is written. Re-importing the same backup never duplicates tickets.<div class="actions" style="margin-top:10px">${btn("↑ Review a prototype backup", "legacy-import", "")}</div></div>` : ""}</section></div>` +
    (isAdmin() ? staffPanel() : "")
  );
}
function staffPanel() {
  return `<div style="height:18px"></div><section class="panel"><div class="panel-heading"><div><h2>Staff & roles</h2><div class="panel-sub">Logins are created in the Firebase console (Authentication → Add user). Paste the user's UID here to give them access.</div></div>${btn("＋ Add person", "edit-user", "tiny")}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${session.users
    .map((u) => `<tr><td><strong>${esc(u.displayName)}</strong><span class="small-muted">${esc(u.email || u.uid)}</span></td><td>${esc(ROLE_LABELS[u.role] || u.role)}</td><td>${u.active ? "Active" : "Disabled"}</td><td><button class="btn tiny" data-action="edit-user" data-id="${esc(u.uid)}">Edit</button></td></tr>`)
    .join("")}</tbody></table></div>${session.users.length ? "" : '<div class="empty-state">No staff profiles yet.</div>'}</section>`;
}
function authScreen() {
  const st = session.authState;
  if (st === "loading") return `<div class="empty-state" style="margin-top:80px">Connecting to the shared database…</div>`;
  if (st === "no-profile" || st === "inactive") {
    return `<section class="panel" style="max-width:520px;margin:40px auto;padding:24px"><h2>${st === "inactive" ? "No access" : "Waiting for access"}</h2><p class="subtitle">${st === "inactive" ? "This account is disabled or does not have a staff role. Only admins and stock controllers use this app." : "You are signed in, but an admin has not given this account a role yet."} Send the admin this user ID:</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;background:#f3f7f5;padding:12px;border-radius:10px">${esc(session.authUser?.uid || "")}</pre><div class="modal-actions">${btn("Sign out", "sign-out", "")}</div></section>`;
  }
  return `<section class="panel" style="max-width:440px;margin:40px auto;padding:24px"><p class="eyebrow">STOCK CONTROL</p><h2>Sign in</h2><p class="subtitle">Use the email and password the admin set up for you.</p><form id="signin-form" style="margin-top:16px"><div class="field"><label for="signin-email">Email</label><input id="signin-email" type="email" autocomplete="username" required maxlength="200" /></div><div class="field"><label for="signin-password">Password</label><input id="signin-password" type="password" autocomplete="current-password" required /></div><div class="modal-actions">${btn("Forgot password", "reset-password", "")}<button class="btn primary" type="submit">Sign in</button></div></form>${session.error ? `<div class="notice warning" style="margin-top:12px">${esc(session.error)}</div>` : ""}</section>`;
}

const VIEWS = { dashboard, inventory, orders, transfers, activity, settings };
function allowedView(v) {
  return VIEWS[v] ? v : "dashboard";
}

function render({ preserve = false } = {}) {
  const main = document.querySelector("#app-main");
  // Live updates from other devices must not wipe what the person is typing.
  const kept = preserve ? [...main.querySelectorAll("input[id], textarea[id], select[id]")].map((el) => [el.id, el.value]) : [];
  const focus = preserve ? document.activeElement : null;
  const focusId = focus && main.contains(focus) ? focus.id : null;
  const sel = focusId && typeof focus.selectionStart === "number" ? [focus.selectionStart, focus.selectionEnd] : null;
  if (document.body) document.body.dataset.role = isShared() ? (signedInReady() ? role() : "signed-out") : "local";
  if (!signedInReady()) {
    main.innerHTML = authScreen();
  } else {
    ui.view = allowedView(ui.view);
    main.innerHTML = VIEWS[ui.view]();
  }
  for (const [id, value] of kept) {
    const el = document.getElementById(id);
    if (el && el.value !== value && !el.disabled) el.value = value;
  }
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (sel && el.setSelectionRange) el.setSelectionRange(sel[0], sel[1]);
    }
  }
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === ui.view));
  document.querySelector("#crumb-current").textContent = signedInReady()
    ? { dashboard: "Overview", inventory: "Inventory", orders: "Order tickets", transfers: "Stock conversions", activity: "Stock history", settings: isShared() ? "Settings & team" : "Settings & backups" }[ui.view]
    : "Sign in";
  document.querySelector("#ticket-pill").textContent = data.tickets.filter((t) => ["review", "new", "preparing", "ready"].includes(t.status)).length || "";
  renderStatus();
}
function renderStatus() {
  const box = document.querySelector(".sidebar-bottom");
  const avatar = document.querySelector(".avatar");
  if (!box) return;
  if (!isShared()) {
    box.innerHTML = `<div class="offline-dot"></div><div><strong>Local prototype</strong><small>Data stays on this device</small></div>`;
    return;
  }
  const conn = { online: ["Online", "#77d5a2"], offline: ["Offline — saved data only", "#f4b953"], connecting: ["Connecting…", "#a6c8bb"] }[session.connection] || ["Connecting…", "#a6c8bb"];
  const name = session.user?.displayName || session.authUser?.email || "Not signed in";
  box.innerHTML = `<div class="offline-dot" style="background:${conn[1]}"></div><div style="min-width:0"><strong>Shared database · ${esc(conn[0])}</strong><small>${esc(name)}${session.user ? " · " + esc(ROLE_LABELS[role()] || role()) : ""}</small>${session.authUser ? `<button type="button" class="btn tiny" data-action="sign-out" style="margin-top:8px;min-height:26px">Sign out</button>` : ""}</div>`;
  if (avatar)
    avatar.textContent =
      String(session.user?.displayName || "SC")
        .split(/\s+/)
        .map((x) => x[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "SC";
}
function navigate(view) {
  ui.view = view;
  document.querySelector("#sidebar").classList.remove("open");
  render();
  window.scrollTo(0, 0);
}
function modal(body, heading, wide = false) {
  document.querySelector("#modal-host").innerHTML = `<div class="modal-shade" role="dialog" aria-modal="true" aria-label="${esc(heading)}"><div class="modal ${wide ? "wide" : ""}"><div class="modal-title"><h2>${esc(heading)}</h2><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div>${body}</div></div>`;
}
function closeModal() {
  document.querySelector("#modal-host").innerHTML = "";
  ui.modal = null;
  ui.draftLines = [];
  ui.unmatched = [];
}
function options(selected = "") {
  return PRODUCTS.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(formatLabel(p))}</option>`).join("");
}
function openStock(id = "", mode = "receive") {
  const p = product(id) || PRODUCTS[0];
  ui.modal = { type: "form" };
  modal(
    `<form id="stock-form"><div class="field"><label for="stock-product">Product</label><select id="stock-product">${options(p.id)}</select></div><div class="form-grid"><div class="field"><label for="stock-operation">Action</label><select id="stock-operation"><option value="in" ${mode === "receive" ? "selected" : ""}>Receive / add</option><option value="out">Remove / write-off</option><option value="count">Set exact stock count</option></select></div><div class="field"><label for="stock-quantity">Quantity (whole packs)</label><input id="stock-quantity" type="number" min="0" step="1" value="1" required /></div></div><div class="field"><label for="stock-reason">Reason / reference</label><input id="stock-reason" placeholder="e.g. Supplier delivery, stocktake, damaged" maxlength="220" required /></div><div class="notice">Current balance: <strong id="stock-current">${qty(p.id)} ${esc(p.unit)}</strong>All changes will appear in stock history.</div><div class="modal-actions">${btn("Cancel", "close-modal", "")}<button type="submit" class="btn primary">Save stock movement</button></div></form>`,
    mode === "receive" ? "Receive stock" : "Adjust stock",
  );
}

// ---------------------------------------------------------------- paste capture
async function capturePastedOrder(raw) {
  const message = String(raw || "").trim();
  if (!message) {
    notify("Paste a WhatsApp order first.", true);
    return;
  }
  if (message.length > D.MAX_MESSAGE) {
    notify("This message is too long. Copy just the order.", true);
    return;
  }
  const managerInput = document.querySelector("#quick-manager"),
    phoneInput = document.querySelector("#quick-phone"),
    siteInput = document.querySelector("#quick-site");
  const manager = (managerInput?.value || "").trim();
  const phone = (phoneInput?.value || "").trim(),
    site = (siteInput?.value || "").trim();
  ui.captureMeta = { manager: managerInput?.value || "", phone, site };
  const area = document.querySelector("#quick-paste-message");
  const res = await run(area, () => backend.capturePaste({ message, manager, phone, site }));
  if (!res) return;
  ui.ticketFilter = "All";
  if (res.queued) {
    navigate("orders");
    notify(
      res.duplicate ? "This message is already waiting to sync on this device." : "No connection — the order is saved on this device only and will become a ticket when you are back online. It is NOT a ticket yet.",
      !res.duplicate,
    );
    return;
  }
  const id = res.ticket?.id || res.ticketId;
  navigate("orders");
  ticketDetails(id);
  if (res.duplicate) notify("This message was recently captured. Opened the existing ticket.");
  else {
    const t = data.tickets.find((x) => x.id === id);
    const matched = t ? t.lines.length : parseWhatsApp(message).lines.length;
    notify(`Ticket ${id} created instantly${isShared() ? " and saved to the shared database" : ""} — check ${matched} matched product(s).`);
  }
}

function draftLineHTML(line, i) {
  return `<div class="line-entry"><select aria-label="Product ${i + 1}" class="order-product">${options(line.productId)}</select><input aria-label="Quantity ${i + 1}" class="order-qty" type="number" min="1" max="9999" value="${esc(line.quantity)}" required /><button type="button" class="round-btn" data-action="remove-line" data-index="${i}" title="Remove line">×</button></div>`;
}
function syncDraft() {
  const rows = [...document.querySelectorAll("#line-host .line-entry")];
  if (rows.length) ui.draftLines = rows.map((row) => ({ productId: row.querySelector(".order-product").value, quantity: Number(row.querySelector(".order-qty").value) }));
}
function redrawLines() {
  const host = document.querySelector("#line-host");
  if (host) host.innerHTML = ui.draftLines.map(draftLineHTML).join("");
}
function newOrder() {
  ui.draftLines = [{ productId: PRODUCTS[0].id, quantity: 1 }];
  ui.modal = { type: "form" };
  modal(
    `<form id="order-form"><div class="notice"><strong>Received in normal WhatsApp?</strong>Copy the manager's message from WhatsApp, paste it below, tap Read product lines, then check the quantities. The app cannot access your chats directly.</div><div style="height:13px"></div><div class="form-grid"><div class="field"><label for="order-manager">Manager name *</label><input id="order-manager" required maxlength="100" placeholder="e.g. Site manager" /></div><div class="field"><label for="order-phone">Manager's regular WhatsApp number</label><input id="order-phone" inputmode="tel" placeholder="e.g. +27 82 123 4567" /></div><div class="field full"><label for="order-site">Site / property / department</label><input id="order-site" maxlength="120" placeholder="Where the supplies are needed" /></div></div>
 <div class="field"><label for="order-message">Paste message from normal WhatsApp (optional)</label><textarea id="order-message" placeholder="Example:\n2 x Pine gel 5 L\n1 x Two-stroke oil 500 ml\n3 x Black bags"></textarea><div class="actions">${btn("↳ Read product lines", "parse-order", "")}</div><small>Matched items are only suggestions. Check all products and quantities before creating the ticket.</small></div><div id="unmatched-lines"></div>
 <div class="section-header"><strong>Order items *</strong>${btn("＋ Add product", "add-line", "tiny")}</div><div class="line-rows" id="line-host"></div><div class="field" style="margin-top:16px"><label for="order-notes">Notes</label><textarea id="order-notes" style="min-height:68px" maxlength="1500" placeholder="Optional preparation or collection instructions"></textarea></div><div class="modal-actions">${btn("Cancel", "close-modal", "")}<button type="submit" class="btn primary">Create order ticket</button></div></form>`,
    "New manager order",
    true,
  );
  redrawLines();
}
function ticketDetails(id) {
  const t = data.tickets.find((x) => x.id === id);
  ui.modal = { type: "ticket", id };
  if (!t) {
    if (isShared()) {
      modal(`<div class="empty-state">Loading ticket ${esc(id)}…</div><div class="modal-actions">${btn("Close", "close-modal", "")}</div>`, "Order ticket · " + id, true);
      return;
    }
    ui.modal = null;
    notify("Ticket not found", true);
    return;
  }
  const steps = ["new", "preparing", "ready", "collected"];
  const stage = steps.indexOf(t.status);
  const staff = isStaff();
  const canCollect = t.lines.length > 0 && t.lines.every((l) => qty(l.productId) >= l.quantity);
  const unresolved = Array.isArray(t.reviewLines) ? t.reviewLines : [];
  const lock = offline() ? "disabled" : "";
  modal(
    `<div class="step-progress" aria-hidden="true">${steps.map((st, i) => `<span class="${stage >= i ? "on" : ""}"></span>`).join("")}</div><div class="actions" style="justify-content:space-between"><div><strong>${esc(t.id)}</strong><p class="small-muted">${esc(dateFmt(t.createdAt))}${t.legacyTicketId ? " · imported from " + esc(t.legacyTicketId) : ""}</p></div>${statusBadge(t.status)}</div>
 ${t.status === "review" ? `<div class="notice warning" style="margin-top:14px"><strong>Ticket saved immediately</strong>${staff ? "This copied WhatsApp request is already in your order queue. Confirm the manager and quantities before preparing or issuing stock." : "The stock controller is checking this request."}</div>` : ""}
 ${offline() ? '<div class="notice warning" style="margin-top:14px"><strong>Offline</strong>Ticket actions are disabled until the connection returns.</div>' : ""}
 <div class="mini-card"><strong>Request from ${esc(t.manager)}</strong>Site: ${esc(t.site || "Not specified")}${staff ? `<br/>WhatsApp: ${esc(t.phone || "Not entered")}` : ""}${t.notes ? `<br/>Notes: ${esc(t.notes)}` : ""}</div>
 <div class="section-header"><strong>Products ${t.status === "review" ? "recognised" : "requested"}</strong></div><div class="order-detail-lines">${t.lines.map((l) => `<div class="detail-line"><img src="${esc(img(l.productId))}" alt=""/><div class="detail-line-name"><strong>${esc(product(l.productId)?.name || l.productId)}</strong><span class="small-muted">${esc(product(l.productId)?.size || "")}${staff ? ` · available: ${qty(l.productId)}` : ""}</span></div><strong>× ${l.quantity}</strong></div>`).join("") || '<div class="notice warning">No catalogue products were recognised. Add them manually using Review and confirm.</div>'}</div>
 ${staff && unresolved.length ? `<div class="notice warning" style="margin-top:15px"><strong>Text to check — not automatically matched</strong>${unresolved.map((line) => `<div>${esc(line)}</div>`).join("")}</div>` : ""}
 ${staff && t.rawMessage ? `<details style="margin-top:17px"><summary class="subtitle" style="cursor:pointer">Original WhatsApp message</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">${esc(t.rawMessage)}</pre></details>` : ""}
 ${staff && !canCollect && ["new", "preparing", "ready"].includes(t.status) ? '<div class="notice warning" style="margin-top:15px"><strong>Insufficient stock</strong>Receive missing stock before marking this order collected.</div>' : ""}
 ${
   staff
     ? `<div class="section-header"><strong>Ticket actions</strong></div><div class="order-actions">
 ${!["collected", "cancelled"].includes(t.status) ? btn(t.status === "review" ? "✓ Review and confirm ticket" : "Edit ticket", "review-ticket", "dark", `data-id="${esc(t.id)}" ${lock}`) : ""}
 ${t.status === "new" ? btn("Start preparing", "status", "dark", `data-id="${esc(t.id)}" data-status="preparing" ${lock}`) : ""}
 ${["new", "preparing"].includes(t.status) ? btn("✓ Ready to collect", "status", "primary", `data-id="${esc(t.id)}" data-status="ready" ${lock}`) : ""}
 ${t.status === "ready" ? btn("Mark collected & deduct stock", "status", "primary", `data-id="${esc(t.id)}" data-status="collected" ${!canCollect || offline() ? "disabled" : ""}`) : ""}
 ${!["cancelled", "collected"].includes(t.status) ? btn("Cancel ticket", "status", "danger", `data-id="${esc(t.id)}" data-status="cancelled" ${lock}`) : ""}</div>
 <div class="order-actions">
 ${t.status !== "review" && t.phone ? btn("Open WhatsApp: acknowledgement", "send-manager", "", `data-id="${esc(t.id)}" data-message="ack"`) : ""}
 ${["ready", "collected"].includes(t.status) && t.phone ? btn("Open WhatsApp: ready notice", "send-manager", "", `data-id="${esc(t.id)}" data-message="ready"`) : ""}
 ${t.status !== "review" && device.ownWhatsApp ? btn("Open my WhatsApp: ticket copy", "send-business", "", `data-id="${esc(t.id)}"`) : ""}
 ${t.status !== "review" ? btn("Copy reply text", "copy-manager-message", "", `data-id="${esc(t.id)}" data-message="${["ready", "collected"].includes(t.status) ? "ready" : "ack"}"`) : ""}
 ${btn("Print ticket", "print-ticket", "", `data-id="${esc(t.id)}"`)}
 </div><p class="footer-note">Normal WhatsApp only. Opening a prefilled chat does not send the message; you must check and tap Send yourself.</p>`
     : `<p class="footer-note">${t.status === "ready" ? "Your order is ready — please arrange collection." : "You will see the status change here as the stock controller processes your request."}</p>`
 }
 <div class="modal-actions">${btn("Close", "close-modal", "")}</div>`,
    "Order ticket · " + id,
    true,
  );
}
function reviewTicket(id) {
  const t = data.tickets.find((x) => x.id === id);
  if (!t || ["collected", "cancelled"].includes(t.status)) {
    notify("Ticket cannot be edited.", true);
    return;
  }
  ui.draftLines = t.lines.map((l) => ({ ...l }));
  ui.modal = { type: "form", id };
  modal(
    `<form id="review-ticket-form"><input type="hidden" id="review-ticket-id" value="${esc(t.id)}" />
  <div class="notice"><strong>Confirm this saved ticket</strong>The ticket was created at paste time. Check the sender, products and pack sizes; only then mark it ready for preparation.</div>
  <div class="form-grid" style="margin-top:17px">
   <div class="field"><label for="review-manager">Manager name *</label><input id="review-manager" maxlength="100" required value="${esc(t.manager === D.MANAGER_PLACEHOLDER ? "" : t.manager)}" /></div>
   <div class="field"><label for="review-phone">Regular WhatsApp number (optional)</label><input id="review-phone" inputmode="tel" value="${esc(t.phone || "")}" /></div>
   <div class="field full"><label for="review-site">Site / property</label><input id="review-site" maxlength="120" value="${esc(t.site || "")}" /></div>
  </div>
  ${Array.isArray(t.reviewLines) && t.reviewLines.length ? `<div class="notice warning"><strong>Unmatched text from original order</strong>${t.reviewLines.map((line) => `<div>${esc(line)}</div>`).join("")}</div>` : ""}
  <div class="section-header"><strong>Confirmed products and quantities *</strong>${btn("＋ Add product", "add-line", "tiny")}</div><div id="line-host" class="line-rows"></div>
  <div class="field" style="margin-top:18px"><label for="review-notes">Notes</label><textarea id="review-notes" maxlength="1500">${esc(t.notes || "")}</textarea></div>
  <details style="margin-top:12px"><summary>Original pasted WhatsApp order</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">${esc(t.rawMessage || "")}</pre></details>
  <div class="modal-actions">${btn("Back", "ticket-detail", "", `data-id="${esc(t.id)}"`)}<button class="btn primary" type="submit">Save and confirm ticket</button></div>
 </form>`,
    "Review ticket · " + id,
    true,
  );
  redrawLines();
}
const whatsappMessage = (t, kind) => D.whatsappMessage(t, kind, data.settings.company);
const orderSummary = (t) => D.orderSummary(t.lines);
function openWhatsApp(rawPhone, message) {
  const phone = whatsappPhone(rawPhone);
  if (!phone) {
    notify("Add a valid WhatsApp number in international format.", true);
    return;
  }
  // Click-to-chat only: opens a draft in the person's normal WhatsApp. Nothing is sent automatically.
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  notify("WhatsApp draft opened. Review and tap Send there.");
}
async function changeStatus(id, status, trigger = null) {
  const t = data.tickets.find((x) => x.id === id);
  const check = D.checkTransition(t, status);
  if (!check.ok) {
    notify(check.error, true);
    return;
  }
  if (status === "collected") {
    const plan = D.planCollection(data.counts, t.lines);
    if (!plan.ok) {
      notify(plan.error, true);
      return;
    }
  }
  const res = await run(trigger, () => backend.changeStatus(id, status), status === "ready" ? "Ticket marked ready. Open the manager's normal WhatsApp draft and tap Send to notify them." : "Ticket updated to " + STATUSES[status] + ".");
  if (res) {
    render({ preserve: true });
    ticketDetails(id);
  }
}
function transferDialog(sourceId) {
  const c = CONVERSIONS.find((x) => x.source === sourceId) || CONVERSIONS[0];
  ui.modal = { type: "form" };
  modal(
    `<form id="transfer-form"><div class="field"><label for="transfer-type">Conversion</label><select id="transfer-type">${CONVERSIONS.map((x) => `<option value="${x.source}" ${x.source === c.source ? "selected" : ""}>${esc(formatLabel(product(x.source)))} → ${esc(formatLabel(product(x.target)))}</option>`).join("")}</select></div><div class="field"><label for="transfer-count">Number of full large containers</label><input id="transfer-count" type="number" min="1" step="1" value="1" required /></div><div id="transfer-preview" class="notice">${qty(c.source)} available · 1 large container becomes ${c.ratio} smaller containers</div><div class="field" style="margin-top:15px"><label for="transfer-reason">Reference / notes</label><input id="transfer-reason" placeholder="e.g. Repack batch or inventory conversion reference" maxlength="220" required /></div><div class="notice warning">Only record a conversion after the stock has genuinely changed pack size. Follow chemical handling and labelling rules.</div><div class="modal-actions">${btn("Cancel", "close-modal", "")}<button type="submit" class="btn primary">Record conversion</button></div></form>`,
    "Convert stock sizes",
  );
}
function userDialog(uid) {
  const u = session.users.find((x) => x.uid === uid) || { uid: "", role: "stock-controller", active: true, displayName: "", email: "" };
  ui.modal = { type: "form" };
  modal(
    `<form id="user-form"><div class="notice"><strong>How access works</strong>1. Create the login in Firebase console → Authentication → Add user. 2. Copy the User UID. 3. Paste it here and choose the role. Roles are checked by the server on every change.</div><div class="form-grid" style="margin-top:14px"><div class="field full"><label for="user-uid">User UID *</label><input id="user-uid" required maxlength="128" value="${esc(u.uid)}" ${u.uid ? "readonly" : ""} /></div><div class="field"><label for="user-name">Name *</label><input id="user-name" required maxlength="100" value="${esc(u.displayName)}" /></div><div class="field"><label for="user-email">Email (for reference)</label><input id="user-email" type="email" maxlength="200" value="${esc(u.email || "")}" /></div><div class="field"><label for="user-role">Role *</label><select id="user-role">${Object.entries(ROLE_LABELS).map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></div><div class="field"><label for="user-active">Access</label><select id="user-active"><option value="1" ${u.active ? "selected" : ""}>Active</option><option value="0" ${u.active ? "" : "selected"}>Disabled</option></select></div></div><p class="footer-note">Admin: everything, including staff and settings. Stock controller: tickets and stock. Site managers do not get accounts — they keep sending requests on normal WhatsApp.</p><div class="modal-actions">${btn("Cancel", "close-modal", "")}<button type="submit" class="btn primary">Save person</button></div></form>`,
    u.uid ? "Edit " + u.displayName : "Add a person",
    true,
  );
}
function legacyPreviewDialog(preview) {
  const newTickets = preview.tickets.filter((t) => !t.exists);
  const byStatus = newTickets.reduce((m, t) => ((m[t.status] = (m[t.status] || 0) + 1), m), {});
  const changed = preview.counts.filter((c) => c.backup !== null && c.backup !== c.current);
  ui.modal = { type: "form" };
  modal(
    `<form id="legacy-form"><div class="notice warning"><strong>Check before importing</strong>Nothing has been written yet. Open requests are imported as <strong>Needs review</strong> so each one is confirmed again. Collected and cancelled tickets are kept as history only and do not change stock. ${preview.movements} old stock-history rows stay in the backup file.</div>
 <div class="section-header"><strong>Tickets</strong></div><p class="subtitle">${newTickets.length} new to import (${Object.entries(byStatus).map(([k, v]) => `${v} ${esc(STATUSES[k])}`).join(", ") || "none"}); ${preview.tickets.length - newTickets.length} already imported and will be skipped.</p>
 <label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="legacy-tickets" ${newTickets.length ? "checked" : "disabled"} /> Import these tickets</label>
 <div class="section-header"><strong>Stock counts</strong></div>${changed.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Shared now</th><th>Backup</th></tr></thead><tbody>${changed.map((c) => `<tr><td>${esc(formatLabel(product(c.productId)))}</td><td>${c.current}</td><td><strong>${c.backup}</strong></td></tr>`).join("")}</tbody></table></div><label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="legacy-counts" /> Set shared stock to the backup counts (recorded as one "Imported count" movement)</label>` : '<p class="subtitle">Shared stock already matches the backup.</p>'}
 <div class="modal-actions">${btn("Cancel", "close-modal", "")}<button type="submit" class="btn primary">Import selected</button></div></form>`,
    "Import prototype backup",
    true,
  );
}

// ---------------------------------------------------------------- exports
function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(v) {
  let x = String(v ?? "");
  if (typeof v !== "number" && /^[\s]*[=+@\-\t\r]/.test(x)) x = "'" + x;
  return '"' + x.replace(/"/g, '""') + '"';
}
function csvExport(filename, headers, rows) {
  downloadText(filename, "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}
function exportData(type) {
  const day = new Date().toISOString().slice(0, 10);
  if (type === "backup") {
    const payload = backend.exportBackup ? backend.exportBackup() : { schema: "firebase-snapshot-1", exportedAt: new Date().toISOString(), counts: data.counts, tickets: data.tickets, movements: data.movements, settings: data.settings };
    downloadText((isShared() ? "stock-control-snapshot-" : "stock-control-backup-") + day + ".json", JSON.stringify(payload, null, 2), "application/json");
  }
  if (type === "stock") csvExport("stock-balances.csv", ["Product", "Pack size", "Units available", "Count unit"], PRODUCTS.map((p) => [p.name, p.size, qty(p.id), p.unit]));
  if (type === "orders") csvExport("order-tickets.csv", ["Ticket", "Date", "Manager", "WhatsApp", "Site", "Products", "Status", "Notes"], data.tickets.map((t) => [t.id, t.createdAt, t.manager, t.phone, t.site, orderSummary(t).replace(/\n/g, "; "), STATUSES[t.status], t.notes]));
  if (type === "history") csvExport("stock-movements.csv", ["Date", "Product", "Pack size", "Movement", "Kind", "Reason", "Ticket"], data.movements.map((m) => [m.at, product(m.productId)?.name, product(m.productId)?.size, m.change, m.kind, m.reason, m.ticketId]));
  notify("Export downloaded.");
}
function printTicket(id) {
  const t = data.tickets.find((x) => x.id === id);
  if (!t) return;
  const popup = window.open("", "_blank");
  if (!popup) {
    notify("Allow popups to print the ticket.", true);
    return;
  }
  popup.document.write(
    `<!doctype html><html><head><title>${esc(t.id)}</title><style>body{font:15px Arial;padding:30px;color:#163b30}li{margin:9px 0}</style></head><body><h1>${esc(data.settings.company)}</h1><h2>Order ticket ${esc(t.id)}</h2><p>Manager: ${esc(t.manager)}<br/>Site: ${esc(t.site)}<br/>Date: ${esc(dateFmt(t.createdAt))}<br/>Status: ${esc(STATUSES[t.status])}</p><h3>Products</h3><ul>${t.lines.map((l) => `<li>${l.quantity} × ${esc(formatLabel(product(l.productId)))}</li>`).join("")}</ul><p>${esc(t.notes)}</p><p>Prepared by: _____________________ &nbsp; Collected by: _____________________</p></body></html>`,
  );
  popup.document.close();
  popup.focus();
  popup.print();
}

// ---------------------------------------------------------------- events
// Event delegation handles all dynamically rendered views and modal controls.
document.addEventListener("click", (e) => {
  const view = e.target.closest("[data-view]");
  if (view) {
    navigate(view.dataset.view);
    return;
  }
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled) return;
  const a = b.dataset.action,
    id = b.dataset.id;
  switch (a) {
    case "close-modal":
      closeModal();
      break;
    case "new-order":
      newOrder();
      break;
    case "stock-receive":
      openStock();
      break;
    case "adjust-stock":
      openStock(id, "adjust");
      break;
    case "category":
      ui.category = b.dataset.category;
      render();
      break;
    case "ticket-filter":
      ui.ticketFilter = b.dataset.status;
      render();
      break;
    case "ticket-detail":
      ticketDetails(id);
      break;
    case "new-transfer":
      transferDialog(b.dataset.source);
      break;
    case "quick-capture":
      capturePastedOrder(document.querySelector("#quick-paste-message")?.value || "");
      break;
    case "review-ticket":
      reviewTicket(id);
      break;
    case "parse-order": {
      const val = document.querySelector("#order-message").value;
      const parsed = parseWhatsApp(val);
      if (parsed.lines.length) {
        ui.draftLines = parsed.lines;
        redrawLines();
      }
      ui.unmatched = parsed.unmatched;
      document.querySelector("#unmatched-lines").innerHTML = parsed.unmatched.length ? `<div class="notice warning"><strong>Could not match these lines</strong>${parsed.unmatched.map(esc).join("<br>")}<br>Please add/check the items manually.</div>` : "";
      notify(`${parsed.lines.length} product types identified. Review before saving.`);
      break;
    }
    case "add-line":
      syncDraft();
      ui.draftLines.push({ productId: PRODUCTS[0].id, quantity: 1 });
      redrawLines();
      break;
    case "remove-line":
      syncDraft();
      ui.draftLines.splice(Number(b.dataset.index), 1);
      redrawLines();
      break;
    case "status":
      changeStatus(id, b.dataset.status, b);
      break;
    case "send-manager": {
      const t = data.tickets.find((x) => x.id === id);
      if (t) openWhatsApp(t.phone, whatsappMessage(t, b.dataset.message));
      break;
    }
    case "copy-manager-message": {
      const t = data.tickets.find((x) => x.id === id);
      if (!t) break;
      const message = whatsappMessage(t, b.dataset.message);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(message)
          .then(() => notify("Reply copied. Paste it into normal WhatsApp and tap Send."))
          .catch(() => notify("Clipboard unavailable. Use Open WhatsApp instead.", true));
      } else notify("Clipboard unavailable. Use Open WhatsApp instead.", true);
      break;
    }
    case "send-business": {
      const t = data.tickets.find((x) => x.id === id);
      if (t) openWhatsApp(device.ownWhatsApp, whatsappMessage(t, "business"));
      break;
    }
    case "print-ticket":
      printTicket(id);
      break;
    case "export-backup":
      exportData("backup");
      break;
    case "export-stock":
      exportData("stock");
      break;
    case "export-orders":
      exportData("orders");
      break;
    case "export-history":
      exportData("history");
      break;
    case "import-backup":
    case "legacy-import":
      document.querySelector("#backup-import").click();
      break;
    case "retry-pending":
      run(b, async () => {
        const done = await backend.retryPending();
        return done;
      }, (done) => (done?.length ? `${done.length} waiting order(s) saved as tickets.` : session.pending.length ? "Still waiting — check the connection or the error shown." : "Nothing waiting."));
      break;
    case "discard-pending":
      if (confirm("Discard this waiting order? It has not become a ticket. Make sure you no longer need it.")) backend.discardPending(id);
      break;
    case "init-db":
      run(b, () => backend.initialiseDatabase(), "First-time setup complete. Stock starts at zero — receive stock or import a prototype backup.");
      break;
    case "edit-user":
      userDialog(id);
      break;
    case "sign-out":
      if (session.pending?.length && !confirm(`${session.pending.length} pasted order(s) are still waiting to sync. They stay on this device for your account and will be sent next time you sign in here. Sign out now?`)) break;
      run(b, () => backend.signOut()).then(() => {
        ui.view = "dashboard";
        closeModal();
      });
      break;
    case "reset-password": {
      const email = document.querySelector("#signin-email")?.value.trim();
      if (!email) {
        notify("Type your email first, then tap Forgot password.", true);
        break;
      }
      run(b, () => backend.resetPassword(email), "If that email has an account, a reset link has been sent.");
      break;
    }
  }
});
document.addEventListener("paste", (e) => {
  if (e.target.id !== "quick-paste-message") return;
  const raw = e.clipboardData?.getData("text/plain");
  if (!raw?.trim()) return;
  e.preventDefault();
  e.target.value = raw;
  capturePastedOrder(raw);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "quick-paste-message" && e.inputType === "insertFromPaste" && e.target.value.trim()) {
    capturePastedOrder(e.target.value);
    return;
  }
  if (["quick-manager", "quick-phone", "quick-site"].includes(e.target.id)) {
    ui.captureMeta = { manager: document.querySelector("#quick-manager")?.value || "", phone: document.querySelector("#quick-phone")?.value || "", site: document.querySelector("#quick-site")?.value || "" };
  }
  if (e.target.id === "inventory-search") {
    const start = e.target.selectionStart;
    ui.search = e.target.value;
    render();
    const input = document.querySelector("#inventory-search");
    input.focus();
    input.setSelectionRange(start, start);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "stock-product") {
    const p = product(e.target.value);
    document.querySelector("#stock-current").textContent = `${qty(p.id)} ${p.unit}`;
  }
  if (e.target.id === "transfer-type") {
    const c = CONVERSIONS.find((x) => x.source === e.target.value);
    document.querySelector("#transfer-preview").textContent = `${qty(c.source)} available · 1 large container becomes ${c.ratio} smaller containers`;
  }
});
const FORMS = ["stock-form", "order-form", "transfer-form", "settings-form", "review-ticket-form", "user-form", "legacy-form", "signin-form"];
document.addEventListener("submit", async (e) => {
  if (!FORMS.includes(e.target.id)) return;
  e.preventDefault();
  const form = e.target.id;
  const submitBtn = e.target.querySelector("button[type=submit]");
  const val = (sel) => document.querySelector(sel)?.value.trim() ?? "";

  if (form === "signin-form") {
    session.error = "";
    await run(submitBtn, () => backend.signIn(val("#signin-email"), document.querySelector("#signin-password").value));
    return;
  }
  if (form === "review-ticket-form") {
    syncDraft();
    const id = val("#review-ticket-id");
    const res = await run(submitBtn, () =>
      backend.reviewTicket(id, { manager: val("#review-manager"), phone: val("#review-phone"), site: val("#review-site"), notes: val("#review-notes"), lines: ui.draftLines }),
      "Ticket confirmed. You can now prepare the order.",
    );
    if (res) {
      render({ preserve: true });
      ticketDetails(id);
    }
    return;
  }
  if (form === "settings-form") {
    const own = val("#business-number");
    if (own && !whatsappPhone(own)) {
      notify("Correct your WhatsApp number or leave it blank.", true);
      return;
    }
    device.ownWhatsApp = own;
    saveDevice();
    if (isShared() && !isAdmin()) {
      notify("Your WhatsApp number is saved on this device.");
      render();
      return;
    }
    const threshold = Number(document.querySelector("#low-threshold").value);
    if (!Number.isSafeInteger(threshold) || threshold < 0) {
      notify("Alert threshold must be a whole number.", true);
      return;
    }
    const ok = await run(submitBtn, async () => (await backend.saveSettings({ company: val("#company"), lowThreshold: threshold }), true), isShared() ? "Shared settings saved." : "Settings saved on this device.");
    if (ok) render();
    return;
  }
  if (form === "stock-form") {
    const amount = Number(document.querySelector("#stock-quantity").value);
    const ok = await run(submitBtn, async () => (await backend.adjustStock({ productId: val("#stock-product"), mode: val("#stock-operation"), amount, reason: val("#stock-reason") }), true), "Stock balance updated.");
    if (ok) {
      closeModal();
      render();
    }
    return;
  }
  if (form === "transfer-form") {
    const count = Number(document.querySelector("#transfer-count").value);
    const c = CONVERSIONS.find((x) => x.source === val("#transfer-type"));
    const ok = await run(submitBtn, async () => (await backend.convertStock({ source: val("#transfer-type"), count, reason: val("#transfer-reason") }), true), `${count} bulk container(s) converted into ${count * (c?.ratio || 0)} small units.`);
    if (ok) {
      closeModal();
      render();
    }
    return;
  }
  if (form === "order-form") {
    syncDraft();
    const res = await run(submitBtn, () =>
      backend.createTicket({ manager: val("#order-manager"), phone: val("#order-phone"), site: val("#order-site"), rawMessage: val("#order-message"), notes: val("#order-notes"), lines: ui.draftLines }),
    );
    if (res) {
      const ticketId = res.ticket?.id || res.ticketId;
      closeModal();
      navigate("orders");
      ticketDetails(ticketId);
      notify(`Ticket ${ticketId} created. Open normal WhatsApp and tap Send to share ticket updates.`);
    }
    return;
  }
  if (form === "user-form") {
    const ok = await run(submitBtn, async () => (
      await backend.saveUser(val("#user-uid"), { role: val("#user-role"), active: val("#user-active") === "1", displayName: val("#user-name"), email: val("#user-email") }), true
    ), "Access saved. The person's app updates automatically.");
    if (ok) closeModal();
    return;
  }
  if (form === "legacy-form") {
    const opts = { tickets: !!document.querySelector("#legacy-tickets")?.checked, counts: !!document.querySelector("#legacy-counts")?.checked };
    if (!opts.tickets && !opts.counts) {
      notify("Select tickets and/or stock counts to import.", true);
      return;
    }
    const res = await run(submitBtn, () => backend.importLegacy(ui.legacyBackup, opts));
    if (res) {
      closeModal();
      notify(`Imported ${res.imported} ticket(s), skipped ${res.skipped}${res.countsSet ? ", stock counts set" : ""}${res.failed.length ? `. ${res.failed.length} failed: ${res.failed.map((f) => f.id + " (" + f.error + ")").join("; ")}` : "."}`, !!res.failed.length);
    }
  }
});
document.querySelector("#backup-import").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const imported = JSON.parse(await f.text());
    if (isShared()) {
      ui.legacyBackup = imported;
      legacyPreviewDialog(backend.previewLegacyImport(imported));
      return;
    }
    if (!backend.validateBackup(imported)) throw Error("Invalid backup schema");
    if (!confirm("Restore this backup? It will replace all tickets, stock counts and history on this device.")) return;
    await backend.restoreBackup(imported);
    navigate("dashboard");
    notify("Backup successfully restored.");
  } catch (err) {
    notify(err instanceof Error && err.message && !/JSON|schema/i.test(err.message) ? err.message : "This is not a valid Stock Control backup.", true);
  } finally {
    e.target.value = "";
  }
});
document.querySelector("#menu-toggle").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
document.querySelector("#today-date").textContent = new Date().toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

// ---------------------------------------------------------------- boot
function onState(s) {
  const wasReady = signedInReady();
  session = s;
  data = { counts: s.counts, tickets: s.tickets, movements: s.movements, settings: s.settings };
  if (s.mode === "local" && !device.ownWhatsApp && s.legacyOwnWhatsApp) {
    device.ownWhatsApp = s.legacyOwnWhatsApp; // carry over the prototype's per-device setting
    saveDevice();
  }
  render({ preserve: wasReady === signedInReady() });
  if (ui.modal?.type === "ticket" && signedInReady()) {
    const scroller = document.querySelector("#modal-host .modal");
    const top = scroller?.scrollTop || 0;
    ticketDetails(ui.modal.id);
    const again = document.querySelector("#modal-host .modal");
    if (again) again.scrollTop = top;
  }
  if (!signedInReady() && ui.modal) closeModal();
}
function resolveBackendMode() {
  const cfg = window.STOCK_CONTROL_CONFIG || {};
  return cfg.backend === "firebase" ? "firebase" : "local";
}
async function startBackend() {
  if (resolveBackendMode() === "local") return window.StockBackends.local.createLocalBackend(window.localStorage);
  const loader = await new Promise((resolve, reject) => {
    if (window.StockFirebase) return resolve(window.StockFirebase);
    const timer = setTimeout(() => reject(new Error("Firebase loader did not start")), 20000);
    window.addEventListener("stock-firebase-loaded", () => (clearTimeout(timer), resolve(window.StockFirebase)), { once: true });
  });
  return loader.start(window.STOCK_CONTROL_CONFIG);
}
(async function boot() {
  session.mode = resolveBackendMode();
  render();
  try {
    backend = await startBackend();
  } catch (e) {
    console.error(e);
    document.querySelector("#app-main").innerHTML = `<section class="panel" style="max-width:520px;margin:40px auto;padding:24px"><h2>Could not connect</h2><p class="subtitle">The shared database could not be loaded. Check your internet connection and reload. If this keeps happening, the Firebase settings in config.js may be incomplete.</p><div class="notice warning">${esc(e.message || e)}</div></section>`;
    return;
  }
  backend.subscribe(onState);
  await backend.init();
  window.addEventListener("online", () => backend.notifyConnectivity?.());
  window.addEventListener("offline", () => backend.notifyConnectivity?.());
})();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Offline mode unavailable", e));
