/* Stock Control — shared domain logic.
 *
 * Pure functions only: no DOM, no storage, no network. Loaded as a classic <script> in the browser
 * (exposes `globalThis.StockDomain`) and with `require()` in Node tests. Both the local prototype
 * backend and the Firebase backend use these rules so behaviour is identical in either mode.
 *
 * Never put API keys, phone numbers or real customer data in this file — the repository is public.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.StockDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PRODUCTS = [
    { id: "two-stroke-500ml", name: "Two-stroke oil", size: "500 ml bottle", group: "Chemicals & liquids", unit: "bottles", img: "two-stroke-500ml.webp", keywords: ["two stroke oil 500 ml", "two-stroke oil 500 ml", "two stroke 500", "two-stroke 500", "2 stroke 500", "2t oil 500"] },
    { id: "two-stroke-20l", name: "Two-stroke oil", size: "20 L bucket", group: "Chemicals & liquids", unit: "buckets", img: "two-stroke-20l.webp", keywords: ["two stroke oil 20 l", "two-stroke oil 20 l", "two stroke 20", "two-stroke 20", "2 stroke 20", "2t oil 20"] },
    { id: "nylon-line", name: "Nylon line", size: "Trimmer line spool", group: "Garden consumables", unit: "spools", img: "nylon-line.webp", keywords: ["nylon", "trimmer line", "brushcutter line"] },
    { id: "pine-gel-5l", name: "Pine gel", size: "5 L bucket", group: "Chemicals & liquids", unit: "buckets", img: "pine-gel-5l.webp", keywords: ["pine gel 5", "pinegel 5"] },
    { id: "pine-gel-20l", name: "Pine gel", size: "20 L bucket", group: "Chemicals & liquids", unit: "buckets", img: "pine-gel-20l.webp", keywords: ["pine gel 20", "pinegel 20"] },
    { id: "non-selective-20l", name: "Non-selective herbicide", size: "20 L plastic container", group: "Chemicals & liquids", unit: "containers", img: "non-selective-20l.webp", keywords: ["non selective herbicide 20", "nonselective herbicide 20", "non selective 20", "non-selective 20", "nonselective 20"] },
    { id: "non-selective-1l", name: "Non-selective herbicide", size: "1 L bottle", group: "Chemicals & liquids", unit: "bottles", img: "non-selective-1l.webp", keywords: ["non selective herbicide 1", "nonselective herbicide 1", "non selective 1", "non-selective 1", "nonselective 1"] },
    { id: "selective-20l", name: "Selective herbicide", size: "20 L container", group: "Chemicals & liquids", unit: "containers", img: "selective-20l.webp", keywords: ["selective 20", "selective herbicide 20"] },
    { id: "selective-5l", name: "Selective herbicide", size: "5 L bucket", group: "Chemicals & liquids", unit: "buckets", img: "selective-5l.webp", keywords: ["selective 5", "selective herbicide 5"] },
    { id: "bleach-5l", name: "Bleach", size: "5 L container", group: "Chemicals & liquids", unit: "containers", img: "bleach-5l.webp", keywords: ["bleach", "jik"] },
    { id: "toilet-paper", name: "Toilet paper", size: "Pack", group: "Cleaning supplies", unit: "packs", img: "toilet-paper.webp", keywords: ["toilet paper", "toilet roll", "toilet tissue"] },
    { id: "black-bags", name: "Black bags", size: "Roll", group: "Cleaning supplies", unit: "rolls", img: "black-bags.webp", keywords: ["black bags", "bin bags", "refuse bags", "garbage bags"] },
    { id: "rake", name: "Garden rake", size: "Complete tool", group: "Tools & equipment", unit: "rakes", img: "rake.webp", keywords: ["rake", "rakes"] },
    { id: "broom", name: "Broom", size: "Complete tool", group: "Tools & equipment", unit: "brooms", img: "broom.webp", keywords: ["broom", "brooms"] },
    { id: "mop", name: "Mop", size: "Complete tool", group: "Tools & equipment", unit: "mops", img: "mop.webp", keywords: ["mop", "mops"] },
    { id: "broom-sticks", name: "Broom sticks", size: "Loose handles", group: "Tools & equipment", unit: "sticks", img: "broom-sticks.webp", keywords: ["broom stick", "broomstick", "handles", "wooden pole"] },
  ];

  // Inventory record conversions only — not instructions for physically repackaging chemicals.
  const CONVERSIONS = [
    { source: "two-stroke-20l", target: "two-stroke-500ml", ratio: 40 },
    { source: "pine-gel-20l", target: "pine-gel-5l", ratio: 4 },
    { source: "non-selective-20l", target: "non-selective-1l", ratio: 20 },
    { source: "selective-20l", target: "selective-5l", ratio: 4 },
  ];

  const STATUSES = {
    review: "Needs review",
    new: "New request",
    preparing: "Preparing",
    ready: "Ready to collect",
    collected: "Collected",
    cancelled: "Cancelled",
  };
  const ACTIVE_STATUSES = ["review", "new", "preparing", "ready"];
  const FINAL_STATUSES = ["collected", "cancelled"];
  // Same transition table as the prototype. Firestore rules enforce exactly this table server-side.
  const TRANSITIONS = {
    review: ["cancelled"], // review -> new happens only through "Review and confirm"
    new: ["preparing", "ready", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["collected", "cancelled"],
    collected: [],
    cancelled: [],
  };
  const MANAGER_PLACEHOLDER = "Manager not specified";
  const DUPLICATE_WINDOW_MS = 60000;
  const MAX_LINE_QTY = 9999;
  const MAX_STOCK_QTY = 1000000;
  const MAX_MESSAGE = 6000;
  const SOURCES = { paste: "manual-whatsapp-paste", manual: "manual-entry", inApp: "in-app-order", legacy: "legacy-import" };

  const MOVEMENT_LABELS = {
    receive: "Received",
    "write-off": "Written off",
    count: "Stock count",
    conversion: "Conversion",
    collection: "Order collected",
    import: "Imported count",
  };

  const product = (id) => PRODUCTS.find((p) => p.id === id);
  const formatLabel = (p) => p.name + " — " + p.size;

  function normaliseOrderText(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/(\d+)\s*(millilitres?|milliliters?)\b/g, "$1 ml")
      .replace(/(\d+)\s*(litres?|liters?)\b/g, "$1 l")
      .replace(/(\d+)\s*(ml|l)\b/g, "$1 $2")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const SEARCH_TABLE = PRODUCTS.map((p) => ({ ...p, finds: [formatLabel(p), ...p.keywords].map(normaliseOrderText) }));

  /** Best-effort parser for a copied WhatsApp order. Never guesses a missing pack size; anything
   * uncertain is returned in `unmatched` so the ticket stays in review with the original text. */
  function parseWhatsApp(raw) {
    const input = String(raw || "")
      .split(/\n|;/)
      .map((l) => l.trim())
      .filter(Boolean);
    const found = new Map();
    const unmatched = [];
    for (let line of input) {
      if (/^(?:from|sender|manager)\s*:/i.test(line)) continue;
      if (/^\s*\[[^\]]+\]\s*[^:\n]{2,65}:\s*/.test(line)) line = line.replace(/^\s*\[[^\]]+\]\s*[^:\n]{2,65}:\s*/, "");
      const low = normaliseOrderText(line);
      let result = null;
      let score = 0;
      const productHits = new Set();
      for (const p of SEARCH_TABLE) {
        for (const k of p.finds) {
          if (k && (" " + low + " ").includes(" " + k + " ")) {
            productHits.add(p.id);
            if (k.length > score) {
              result = p;
              score = k.length;
            }
          }
        }
      }
      if (!result) {
        unmatched.push(line);
        continue;
      }
      // "Non-selective" must never fall through to a selective product (e.g. "non-selective 5 L" does
      // not exist; the keyword "selective 5" would otherwise match the wrong herbicide).
      if (/\bnon ?selective\b/.test(low) && !result.id.startsWith("non-selective")) {
        unmatched.push(line);
        continue;
      }
      // Two requested products in the same sentence need manual review, not a guessed one-item order.
      const separateAmounts = (low.match(/\b\d+\s*x\b/g) || []).length;
      if (productHits.size > 1 && (/\b(?:and|plus)\b|[,&+]/i.test(line) || separateAmounts > 1)) {
        unmatched.push(line);
        continue;
      }
      let leading = low.match(/^(\d+)\s*(?:x|of|bottles?|buckets?|containers?|rolls?|packs?|spools?|pcs?|pieces?)?\s/);
      if (/^\d+\s+(?:l|ml)\b/.test(low)) leading = null; // a pack size is not an order quantity
      const trailing = low.match(/(?:x|qty|quantity)\s*(\d+)\s*$/);
      const embedded = !leading && !trailing ? low.match(/\b(\d+)\s*x\b/) : null;
      const amount = leading ? Number(leading[1]) : trailing ? Number(trailing[1]) : embedded ? Number(embedded[1]) : 1;
      if (!leading && !trailing && !embedded) unmatched.push("Quantity assumed as 1 — confirm: " + line);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_LINE_QTY || (found.get(result.id) || 0) + amount > MAX_LINE_QTY) {
        unmatched.push(line);
        continue;
      }
      found.set(result.id, (found.get(result.id) || 0) + amount);
    }
    return { lines: [...found].map(([productId, quantity]) => ({ productId, quantity })), unmatched };
  }

  function capturedManager(raw) {
    const msg = String(raw || "");
    const named = msg.match(/(?:^|\n)\s*(?:From|Manager|Sender)\s*:\s*([^\n]{2,75})/i);
    const header = msg.match(/^\s*\[[^\]]+\]\s*([^:\n]{2,70})\s*:/);
    return (named?.[1] || header?.[1] || "").trim().slice(0, 100);
  }

  /** Normalise a South African / international number for a wa.me click-to-chat link. */
  function whatsappPhone(raw) {
    let s = String(raw || "").replace(/\D/g, "");
    if (s.startsWith("00")) s = s.slice(2);
    if (s.startsWith("0") && s.length === 10) s = "27" + s.slice(1);
    return /^[1-9]\d{7,14}$/.test(s) ? s : null;
  }

  /** Validate + merge duplicate product lines. Returns {ok, lines, error}. */
  function combineLines(lines) {
    if (!Array.isArray(lines) || !lines.length) return { ok: false, error: "Add at least one valid product with a whole quantity." };
    const combined = new Map();
    for (const l of lines) {
      if (!l || !product(l.productId) || !Number.isSafeInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_LINE_QTY)
        return { ok: false, error: "Add at least one valid product with a whole quantity." };
      combined.set(l.productId, (combined.get(l.productId) || 0) + l.quantity);
    }
    if ([...combined.values()].some((n) => n > MAX_LINE_QTY)) return { ok: false, error: "Total quantity per product cannot exceed 9999." };
    return { ok: true, lines: sortLines([...combined].map(([productId, quantity]) => ({ productId, quantity }))) };
  }

  const catalogueIndex = (id) => {
    const i = PRODUCTS.findIndex((p) => p.id === id);
    return i < 0 ? 999 : i;
  };
  const sortLines = (lines) => [...lines].sort((a, b) => catalogueIndex(a.productId) - catalogueIndex(b.productId));
  const linesToItems = (lines) => Object.fromEntries((lines || []).map((l) => [l.productId, l.quantity]));
  const itemsToLines = (items) => sortLines(Object.entries(items || {}).map(([productId, quantity]) => ({ productId, quantity })));

  function isConfirmedManager(name) {
    const m = String(name || "").trim();
    return !!m && m !== MANAGER_PLACEHOLDER;
  }

  /** Can ticket `t` move to `status`? Returns {ok, error}. Mirrors firestore.rules. */
  function checkTransition(t, status) {
    if (!t) return { ok: false, error: "Ticket not found." };
    if (!TRANSITIONS[t.status]?.includes(status)) return { ok: false, error: "This status change is not allowed." };
    if (["preparing", "ready", "collected"].includes(status) && (!isConfirmedManager(t.manager) || !(t.lines || []).length))
      return { ok: false, error: "Confirm the manager and order items first." };
    return { ok: true };
  }

  /** Stock needed to collect a ticket. Returns {ok, out, shortages}. */
  function planCollection(onHand, lines) {
    const combined = combineLines(lines);
    if (!combined.ok) return { ok: false, error: combined.error, shortages: [] };
    const out = linesToItems(combined.lines);
    const shortages = Object.entries(out)
      .filter(([pid, q]) => Number(onHand[pid] || 0) < q)
      .map(([pid, q]) => ({ productId: pid, need: q, have: Number(onHand[pid] || 0) }));
    if (shortages.length) return { ok: false, error: "Not enough stock to hand over " + product(shortages[0].productId).name, shortages, out };
    return { ok: true, out, shortages: [] };
  }

  /** Receive / write-off / exact count. Returns {ok, kind, added, removed, error}. */
  function planStockChange(onHand, productId, mode, amount) {
    if (!product(productId)) return { ok: false, error: "Unknown product." };
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_STOCK_QTY) return { ok: false, error: "Enter a valid quantity and reason." };
    if (mode !== "count" && amount === 0) return { ok: false, error: "Quantity must be greater than zero." };
    const have = Number(onHand[productId] || 0);
    const change = mode === "in" ? amount : mode === "out" ? -amount : amount - have;
    if (have + change < 0) return { ok: false, error: "Cannot remove more than is available." };
    if (change === 0) return { ok: false, error: "The count already matches the current balance — nothing to record." };
    const kind = mode === "count" ? "count" : mode === "in" ? "receive" : "write-off";
    return { ok: true, kind, added: change > 0 ? { [productId]: change } : {}, removed: change < 0 ? { [productId]: -change } : {} };
  }

  function planConversion(onHand, sourceId, count) {
    const c = CONVERSIONS.find((x) => x.source === sourceId);
    if (!c || !Number.isSafeInteger(count) || count <= 0 || count > 100000) return { ok: false, error: "Enter a valid whole-container count and reference." };
    if (Number(onHand[c.source] || 0) < count) return { ok: false, error: "Not enough source containers are available." };
    return { ok: true, kind: "conversion", conversion: c, removed: { [c.source]: count }, added: { [c.target]: count * c.ratio } };
  }

  /** Apply a movement to a balance map. Throws if any balance would go negative. */
  function applyMovement(onHand, added, removed) {
    const next = { ...onHand };
    for (const [pid, q] of Object.entries(removed || {})) next[pid] = Number(next[pid] || 0) - q;
    for (const [pid, q] of Object.entries(added || {})) next[pid] = Number(next[pid] || 0) + q;
    for (const [pid, q] of Object.entries(next)) if (!Number.isSafeInteger(q) || q < 0) throw new Error("Stock for " + (product(pid)?.name || pid) + " cannot go below zero.");
    return next;
  }

  /** Movement → one row per product, for the stock history table and CSV. */
  function movementRows(m) {
    const rows = [];
    for (const [pid, q] of Object.entries(m.removed || {})) rows.push({ productId: pid, change: -q });
    for (const [pid, q] of Object.entries(m.added || {})) rows.push({ productId: pid, change: q });
    const label = MOVEMENT_LABELS[m.kind] || m.kind;
    return rows.map((r) => ({ id: m.id + ":" + r.productId, at: m.at, productId: r.productId, change: r.change, kind: m.kind === "conversion" ? label + (r.change < 0 ? " out" : " in") : label, reason: m.reason || "", ticketId: m.ticketId || null }));
  }

  /** Calendar day in South Africa (UTC+2, no DST) as YYYYMMDD — used in ticket numbers. */
  function sastDayKey(date = new Date()) {
    const d = new Date(date.getTime() + 2 * 3600 * 1000);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  const formatTicketId = (day, seq) => `SC-${day}-${String(seq).padStart(4, "0")}`;

  /** Text that identifies "the same paste" for duplicate detection (hashed before storage). */
  const pasteFingerprint = (message, manager, site) => [String(message || "").trim(), String(manager || MANAGER_PLACEHOLDER).trim(), String(site || "").trim()].join("␞");

  function orderSummary(lines) {
    return (lines || []).map((l) => `${l.quantity} × ${product(l.productId) ? formatLabel(product(l.productId)) : l.productId}`).join("\n");
  }
  function whatsappMessage(t, kind, company) {
    const name = company || "Stock Control";
    if (kind === "ack") return `Hello ${t.manager}, your stock request has been logged.\nTicket: ${t.id}\n${orderSummary(t.lines)}\nWe will let you know when your order is ready.\n— ${name}`;
    if (kind === "ready") return `Hello ${t.manager}, your stock order is ready for collection.\nTicket: ${t.id}\n${orderSummary(t.lines)}\nPlease arrange collection.\n— ${name}`;
    return `New stock order ticket ${t.id}\nManager: ${t.manager}\nSite: ${t.site || "Not specified"}\n${orderSummary(t.lines)}\nStatus: ${STATUSES[t.status]}`;
  }

  return {
    PRODUCTS, CONVERSIONS, STATUSES, ACTIVE_STATUSES, FINAL_STATUSES, TRANSITIONS, MANAGER_PLACEHOLDER, DUPLICATE_WINDOW_MS,
    MAX_LINE_QTY, MAX_STOCK_QTY, MAX_MESSAGE, SOURCES, MOVEMENT_LABELS,
    product, formatLabel, normaliseOrderText, parseWhatsApp, capturedManager, whatsappPhone, combineLines, sortLines,
    linesToItems, itemsToLines, isConfirmedManager, checkTransition, planCollection, planStockChange, planConversion,
    applyMovement, movementRows, sastDayKey, formatTicketId, pasteFingerprint, orderSummary, whatsappMessage,
  };
});
