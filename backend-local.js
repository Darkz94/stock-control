/* Stock Control — local prototype backend (single device, browser localStorage).
 *
 * Same async interface as backend-firebase.mjs so app.js does not care which one is active.
 * This mode is NOT a multi-device source of truth: one browser, no login, no shared data.
 */
(function (root) {
  "use strict";
  const D = root.StockDomain || (typeof require === "function" ? require("./domain.js") : null);
  const KEY = "stock_control_local_v1";

  const initial = () => ({
    schema: 1,
    counts: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, 0])),
    tickets: [],
    movements: [],
    nextTicket: 1,
    settings: { company: "Stock Control", businessWhatsApp: "", lowThreshold: 2 },
  });

  function validateData(v) {
    return !!(v && v.schema === 1 && v.counts && typeof v.counts === "object" && Array.isArray(v.tickets) && Array.isArray(v.movements) && v.settings && Number.isSafeInteger(v.nextTicket));
  }
  function validateBackup(v) {
    return (
      validateData(v) &&
      D.PRODUCTS.every((p) => Number.isSafeInteger(v.counts[p.id]) && v.counts[p.id] >= 0) &&
      v.tickets.every((t) => Array.isArray(t.lines) && t.lines.every((l) => D.product(l.productId) && Number.isSafeInteger(l.quantity) && l.quantity >= 1))
    );
  }

  function createLocalBackend(storage) {
    let data;
    try {
      const saved = JSON.parse(storage.getItem(KEY) || "null");
      data = validateData(saved) ? saved : initial();
    } catch (_) {
      data = initial();
    }
    const listeners = new Set();
    const nowIso = () => new Date().toISOString();
    const uuid = () => root.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);

    function state() {
      return {
        mode: "local",
        ready: true,
        connection: "local",
        user: { uid: "local-device", role: "admin", displayName: "This device", active: true },
        counts: data.counts,
        tickets: data.tickets,
        movements: data.movements,
        settings: { company: data.settings.company, lowThreshold: data.settings.lowThreshold },
        legacyOwnWhatsApp: data.settings.businessWhatsApp || "",
        users: [],
      };
    }
    function emit() {
      const s = state();
      listeners.forEach((fn) => fn(s));
    }
    function persist() {
      try {
        storage.setItem(KEY, JSON.stringify(data));
      } catch (e) {
        throw new Error("Could not save. Export a backup and free browser space.");
      }
    }
    function commit() {
      persist();
      emit();
    }
    const find = (id) => data.tickets.find((t) => t.id === id);
    const nextId = () => D.formatTicketId(nowIso().slice(0, 10).replace(/-/g, ""), data.nextTicket++);

    function recordMovement(kind, added, removed, reason, ticketId = null) {
      const next = D.applyMovement(data.counts, added, removed); // throws before anything changes
      const m = { id: uuid(), at: nowIso(), kind, added, removed, reason: String(reason || ""), ticketId };
      data.counts = next;
      data.movements.unshift(...D.movementRows(m));
    }

    const api = {
      mode: "local",
      capabilities: { auth: false, shared: false, backupRestore: true, staffAdmin: false, legacyImport: false },
      async init() {
        return state();
      },
      subscribe(fn) {
        listeners.add(fn);
        fn(state());
        return () => listeners.delete(fn);
      },
      async capturePaste({ message, manager, phone, site }) {
        message = String(message || "").trim();
        if (!message) throw new Error("Paste a WhatsApp order first.");
        if (message.length > D.MAX_MESSAGE) throw new Error("This message is too long. Copy just the order.");
        manager = String(manager || "").trim() || D.capturedManager(message);
        site = String(site || "").trim();
        const duplicate = data.tickets.find(
          (t) => t.source === D.SOURCES.paste && t.rawMessage === message && t.manager === (manager || D.MANAGER_PLACEHOLDER) && t.site === site && Date.now() - Date.parse(t.createdAt) < D.DUPLICATE_WINDOW_MS,
        );
        if (duplicate) return { ticket: duplicate, duplicate: true };
        const parsed = D.parseWhatsApp(message);
        const at = nowIso();
        const t = {
          id: nextId(),
          manager: manager || D.MANAGER_PLACEHOLDER,
          phone: String(phone || "").trim(),
          site,
          rawMessage: message,
          notes: "",
          lines: parsed.lines,
          reviewLines: parsed.unmatched,
          status: "review",
          source: D.SOURCES.paste,
          createdAt: at,
          updatedAt: at,
        };
        data.tickets.unshift(t);
        commit();
        return { ticket: t, duplicate: false };
      },
      async createTicket({ manager, phone, site, rawMessage, notes, lines }) {
        manager = String(manager || "").trim();
        const combined = D.combineLines(lines);
        if (!D.isConfirmedManager(manager) || !combined.ok) throw new Error("Enter a manager and one or more valid product quantities.");
        if (phone && !D.whatsappPhone(phone)) throw new Error("Use a valid WhatsApp number, or leave the field empty.");
        const at = nowIso();
        const t = { id: nextId(), manager, phone: phone || "", site: site || "", rawMessage: rawMessage || "", notes: notes || "", lines: combined.lines, reviewLines: [], status: "new", source: D.SOURCES.manual, createdAt: at, updatedAt: at };
        data.tickets.unshift(t);
        commit();
        return { ticket: t };
      },
      async reviewTicket(id, { manager, phone, site, notes, lines }) {
        const t = find(id);
        if (!t || D.FINAL_STATUSES.includes(t.status)) throw new Error("Ticket cannot be edited.");
        manager = String(manager || "").trim();
        if (!D.isConfirmedManager(manager)) throw new Error("Enter the manager name.");
        if (phone && !D.whatsappPhone(phone)) throw new Error("Correct the WhatsApp number or leave it blank.");
        const combined = D.combineLines(lines);
        if (!combined.ok) throw new Error(combined.error);
        Object.assign(t, { manager, phone: phone || "", site: site || "", notes: notes || "", lines: combined.lines, reviewLines: [], reviewedAt: nowIso() });
        t.updatedAt = t.reviewedAt;
        if (t.status === "review") t.status = "new";
        commit();
        return { ticket: t };
      },
      async changeStatus(id, status) {
        const t = find(id);
        const check = D.checkTransition(t, status);
        if (!check.ok) throw new Error(check.error);
        if (status === "collected") {
          const plan = D.planCollection(data.counts, t.lines);
          if (!plan.ok) throw new Error(plan.error);
          recordMovement("collection", {}, plan.out, `Issued on ticket ${id}`, id);
        }
        t.status = status;
        t.updatedAt = nowIso();
        commit();
        return { ticket: t };
      },
      async adjustStock({ productId, mode, amount, reason }) {
        reason = String(reason || "").trim();
        if (!reason) throw new Error("Enter a valid quantity and reason.");
        const plan = D.planStockChange(data.counts, productId, mode, amount);
        if (!plan.ok) throw new Error(plan.error);
        recordMovement(plan.kind, plan.added, plan.removed, reason);
        commit();
      },
      async convertStock({ source, count, reason }) {
        reason = String(reason || "").trim();
        if (!reason) throw new Error("Enter a valid whole-container count and reference.");
        const plan = D.planConversion(data.counts, source, count);
        if (!plan.ok) throw new Error(plan.error);
        recordMovement("conversion", plan.added, plan.removed, reason);
        commit();
        return plan;
      },
      async saveSettings({ company, lowThreshold }) {
        if (!Number.isSafeInteger(lowThreshold) || lowThreshold < 0) throw new Error("Alert threshold must be a whole number.");
        data.settings.company = String(company || "").trim() || "Stock Control";
        data.settings.lowThreshold = lowThreshold;
        commit();
      },
      exportBackup() {
        return JSON.parse(JSON.stringify(data));
      },
      validateBackup,
      async restoreBackup(imported) {
        if (!validateBackup(imported)) throw new Error("This is not a valid Stock Control backup.");
        data = imported;
        commit();
      },
      // Test hook only.
      _data: () => data,
    };
    return api;
  }

  const exported = { createLocalBackend, validateBackup, LOCAL_KEY: KEY };
  if (typeof module === "object" && module.exports) module.exports = exported;
  root.StockBackends = Object.assign(root.StockBackends || {}, { local: exported });
})(typeof globalThis !== "undefined" ? globalThis : this);
