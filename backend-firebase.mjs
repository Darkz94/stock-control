/* Stock Control — Firebase (Authentication + Cloud Firestore) backend.
 *
 * Exposes the same async interface as backend-local.js. Every change runs in a Firestore transaction
 * and resolves only after the server has committed it — the UI never shows success before that.
 * Firestore security rules (firestore.rules) independently enforce the stock and ticket invariants, so
 * a modified or buggy client still cannot create negative stock, double collections or lost history.
 *
 * The Firebase SDK is injected (`sdk`) so the same code runs in the browser (CDN modules, see
 * firebase-loader.mjs) and in Node tests against the emulators (npm `firebase` package).
 */

const PENDING_KEY = "stock_control_pending_pastes_v1";
const TX_TIMEOUT_MS = 25000;

export class UserError extends Error {}
export class OfflineError extends UserError {}

export function createFirebaseBackend({ sdk, domain: D, auth, db, storage = null, isOnline = () => true, timeoutMs = TX_TIMEOUT_MS }) {
  const {
    doc, collection, query, where, orderBy, limit, onSnapshot, runTransaction, serverTimestamp,
    onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  } = sdk;

  const listeners = new Set();
  let unsubs = [];
  let profileUnsub = null;
  const fromCache = {};
  const s = {
    mode: "firebase",
    ready: false,
    authState: "loading", // loading | signed-out | no-profile | inactive | ready
    connection: "connecting", // connecting | online | offline
    authUser: null,
    user: null,
    counts: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, 0])),
    balancesExists: null,
    balancesVersion: 0,
    tickets: [],
    movements: [],
    settings: { company: "Stock Control", lowThreshold: 2 },
    settingsExists: null,
    conversionsExists: null,
    users: [],
    pending: [],
    error: "",
  };
  let ticketsRecent = new Map();
  let ticketsActive = new Map();

  // ---------- state plumbing ----------
  function emit() {
    s.connection = !isOnline() ? "offline" : Object.values(fromCache).some(Boolean) ? "connecting" : "online";
    const snap = { ...s };
    listeners.forEach((fn) => fn(snap));
  }
  // Waiting pastes are kept per signed-in user, so another person on this device never submits them.
  const pendingKey = () => PENDING_KEY + ":" + (s?.authUser?.uid || "signed-out");
  function readPending() {
    try {
      const v = JSON.parse(storage?.getItem(pendingKey()) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }
  function writePending(list) {
    s.pending = list;
    try {
      storage?.setItem(pendingKey(), JSON.stringify(list));
    } catch (_) {
      /* storage full or unavailable: pending list stays in memory for this session */
    }
    emit();
  }

  const ts = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : typeof v === "string" ? v : null);
  function normaliseTicket(snapDoc) {
    const d = snapDoc.data({ serverTimestamps: "estimate" });
    return {
      id: d.ticketId || snapDoc.id,
      manager: d.manager || D.MANAGER_PLACEHOLDER,
      managerUid: d.managerUid || null,
      phone: d.phone || "",
      site: d.site || "",
      notes: d.notes || "",
      rawMessage: d.rawMessage || "",
      lines: D.itemsToLines(d.items),
      reviewLines: Array.isArray(d.reviewLines) ? d.reviewLines : [],
      status: d.status,
      source: d.source,
      createdAt: ts(d.createdAt) || new Date().toISOString(),
      updatedAt: ts(d.updatedAt),
      reviewedAt: ts(d.reviewedAt),
      collectedAt: ts(d.collectedAt),
      legacyTicketId: d.legacyTicketId || null,
      pendingWrite: snapDoc.metadata.hasPendingWrites,
    };
  }
  function rebuildTickets() {
    const all = new Map([...ticketsRecent, ...ticketsActive]);
    s.tickets = [...all.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function listen(key, ref, onData) {
    const unsub = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        fromCache[key] = snap.metadata.fromCache;
        onData(snap);
        if (key === "tickets-recent" || key === "tickets-active" || key === "tickets-mine") rebuildTickets();
        emit();
      },
      (err) => {
        s.error = friendlyError(err).message;
        emit();
      },
    );
    unsubs.push(unsub);
  }
  function stopData() {
    unsubs.forEach((u) => u());
    unsubs = [];
    for (const k of Object.keys(fromCache)) delete fromCache[k];
    ticketsRecent = new Map();
    ticketsActive = new Map();
    s.tickets = [];
    s.movements = [];
    s.users = [];
  }

  function startData(role) {
    stopData();
    const staff = role === "admin" || role === "stock-controller";
    listen("settings", doc(db, "settings", "app"), (d) => {
      s.settingsExists = d.exists();
      if (d.exists()) s.settings = { company: d.data().company || "Stock Control", lowThreshold: Number(d.data().lowThreshold ?? 2) };
    });
    if (staff) {
      listen("balances", doc(db, "inventory", "balances"), (d) => {
        s.balancesExists = d.exists();
        const onHand = d.exists() ? d.data().onHand || {} : {};
        s.counts = Object.fromEntries(D.PRODUCTS.map((p) => [p.id, Number(onHand[p.id] || 0)]));
        s.balancesVersion = d.exists() ? d.data().version : 0;
      });
      listen("conversions", doc(db, "settings", "conversions"), (d) => (s.conversionsExists = d.exists()));
      listen("tickets-recent", query(collection(db, "tickets"), orderBy("createdAt", "desc"), limit(250)), (q) => {
        ticketsRecent = new Map(q.docs.map((x) => [x.id, normaliseTicket(x)]));
      });
      // Active tickets are always loaded, however old, so nothing open can fall off the list.
      listen("tickets-active", query(collection(db, "tickets"), where("status", "in", D.ACTIVE_STATUSES), orderBy("createdAt", "desc")), (q) => {
        ticketsActive = new Map(q.docs.map((x) => [x.id, normaliseTicket(x)]));
      });
      listen("movements", query(collection(db, "stockMovements"), orderBy("at", "desc"), limit(300)), (q) => {
        s.movements = q.docs.flatMap((x) => {
          const m = x.data({ serverTimestamps: "estimate" });
          return D.movementRows({ id: x.id, at: ts(m.at), kind: m.kind, added: m.added, removed: m.removed, reason: m.reason, ticketId: m.ticketId });
        });
      });
      listen("users", collection(db, "users"), (q) => {
        s.users = q.docs.map((x) => ({ uid: x.id, ...x.data() })).sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
      });
    } else {
      listen("tickets-mine", query(collection(db, "tickets"), where("managerUid", "==", s.authUser.uid), orderBy("createdAt", "desc"), limit(100)), (q) => {
        ticketsRecent = new Map(q.docs.map((x) => [x.id, normaliseTicket(x)]));
      });
    }
  }

  function watchProfile(authUser) {
    profileUnsub?.();
    profileUnsub = onSnapshot(
      doc(db, "users", authUser.uid),
      (d) => {
        const before = s.user?.role + "|" + s.user?.active;
        if (!d.exists()) {
          s.user = null;
          s.authState = "no-profile";
          stopData();
        } else {
          const u = { uid: authUser.uid, email: authUser.email || "", ...d.data() };
          s.user = u;
          s.authState = u.active === true ? "ready" : "inactive";
          if (s.authState !== "ready") stopData();
          else if (before !== u.role + "|" + u.active) startData(u.role);
        }
        s.ready = true;
        emit();
        if (s.authState === "ready") flushPending().catch(() => {});
      },
      (err) => {
        s.error = friendlyError(err).message;
        s.authState = "no-profile";
        s.ready = true;
        emit();
      },
    );
  }

  // ---------- helpers ----------
  const me = () => {
    if (s.authState !== "ready" || !s.user) throw new UserError("Sign in with an approved account first.");
    return s.user;
  };
  const isStaff = () => ["admin", "stock-controller"].includes(s.user?.role);
  const requireStaff = () => {
    if (!isStaff()) throw new UserError("Only stock controllers and admins can do this.");
  };
  const requireAdmin = () => {
    if (s.user?.role !== "admin") throw new UserError("Only an admin can do this.");
  };
  const newId = (col) => doc(collection(db, col)).id;
  const requireOnline = () => {
    if (!isOnline()) throw new OfflineError("You are offline. Stock and ticket changes need a connection so they can be confirmed by the server.");
  };

  function friendlyError(e) {
    if (e instanceof UserError) return e;
    const code = e?.code || "";
    if (code === "permission-denied") return new UserError("The server refused this change. Your role may not allow it, or the record changed on another device — check the latest data and try again.");
    if (code === "unavailable" || code === "deadline-exceeded") return new OfflineError("Could not reach the server. Nothing was confirmed — check your connection and try again.");
    if (code === "aborted" || code === "failed-precondition") return new UserError("Another device changed this record at the same time. Check the latest data and try again.");
    if (code === "unauthenticated") return new UserError("Your sign-in has expired. Sign in again.");
    if (String(code).startsWith("auth/")) {
      if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(code)) return new UserError("Email or password is incorrect.");
      if (code === "auth/too-many-requests") return new UserError("Too many attempts. Wait a few minutes and try again.");
      if (code === "auth/network-request-failed") return new OfflineError("Could not reach the sign-in server. Check your connection.");
    }
    return new UserError("Something went wrong and nothing was confirmed. " + (e?.message ? "(" + e.message + ")" : ""));
  }

  async function tx(fn) {
    requireOnline();
    let timer;
    try {
      return await Promise.race([
        runTransaction(db, fn, { maxAttempts: 5 }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new OfflineError("No confirmation from the server yet. Check the ticket list or stock history before trying again.")), timeoutMs);
        }),
      ]);
    } catch (e) {
      throw friendlyError(e);
    } finally {
      clearTimeout(timer);
    }
  }

  function audit(t, type, targetType, targetId, summary, details = {}) {
    const auditId = newId("auditLogs");
    t.set(doc(db, "auditLogs", auditId), { type, targetType, targetId, actorUid: s.user.uid, at: serverTimestamp(), summary: String(summary).slice(0, 300), details });
    return auditId;
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** Reserve the next SC-YYYYMMDD-#### number inside transaction `t`. All reads happen here. */
  async function reserveTicketId(t) {
    const day = D.sastDayKey(new Date());
    const counterRef = doc(db, "counters", "tickets-" + day);
    const c = await t.get(counterRef);
    const seq = c.exists() ? Number(c.data().next) + 1 : 1;
    if (seq > 9999) throw new UserError("Daily ticket limit reached (9999).");
    const ticketId = D.formatTicketId(day, seq);
    const ticketRef = doc(db, "tickets", ticketId);
    return { day, seq, ticketId, ticketRef, counterRef };
  }

  function baseTicket(r, fields) {
    return {
      ticketId: r.ticketId, seq: r.seq, day: r.day,
      status: fields.status, source: fields.source,
      manager: fields.manager, managerUid: fields.managerUid ?? null,
      phone: fields.phone || "", site: fields.site || "", notes: fields.notes || "", rawMessage: fields.rawMessage || "",
      items: D.linesToItems(fields.lines), reviewLines: fields.reviewLines || [], pasteKey: fields.pasteKey ?? null,
      createdAt: serverTimestamp(), createdBy: s.user.uid, updatedAt: serverTimestamp(), updatedBy: s.user.uid,
      reviewedAt: null, reviewedBy: null, collectedAt: null, collectedBy: null, collectionMovementId: null,
      cancelledAt: null, cancelledBy: null, cancelReason: null,
    };
  }

  async function writeNewTicket(fields, extraReads) {
    return tx(async (t) => {
      const pre = extraReads ? await extraReads(t) : null;
      if (pre?.done) return pre.done;
      const r = await reserveTicketId(t);
      if ((await t.get(r.ticketRef)).exists()) throw new UserError("Ticket number clash — please try again.");
      const auditId = audit(t, "ticket.created", "ticket", r.ticketId, `Ticket created (${fields.source})`, { status: fields.status, source: fields.source });
      t.set(r.counterRef, { next: r.seq, updatedAt: serverTimestamp() });
      t.set(r.ticketRef, { ...baseTicket(r, fields), lastAuditId: auditId });
      pre?.afterTicket?.(t, r);
      return { ticketId: r.ticketId, duplicate: false };
    });
  }

  async function ticketWrite(id, build) {
    return tx(async (t) => {
      const ref = doc(db, "tickets", id);
      const snap = await t.get(ref);
      if (!snap.exists()) throw new UserError("Ticket not found.");
      const cur = normaliseTicket(snap);
      const extra = build.reads ? await build.reads(t, cur, snap.data()) : {};
      const { update, type, summary, details, after } = build.write(t, cur, snap.data(), extra);
      const auditId = audit(t, type, "ticket", id, summary, details);
      t.update(ref, { ...update, updatedAt: serverTimestamp(), updatedBy: s.user.uid, lastAuditId: auditId });
      after?.(t);
      return { ticketId: id };
    });
  }

  async function stockMovement(kind, buildPlan, reason, mvId = null) {
    return tx(async (t) => {
      const balRef = doc(db, "inventory", "balances");
      const bal = await t.get(balRef);
      if (!bal.exists()) throw new UserError("The shared stock record is not set up yet. An admin must run first-time setup in Settings.");
      if (mvId && (await t.get(doc(db, "stockMovements", mvId))).exists()) throw new UserError("This stock change has already been recorded.");
      const onHand = bal.data().onHand || {};
      const plan = buildPlan(onHand);
      if (!plan.ok) throw new UserError(plan.error);
      const next = D.applyMovement(onHand, plan.added, plan.removed);
      const id = mvId || newId("stockMovements");
      t.set(doc(db, "stockMovements", id), {
        kind, added: plan.added, removed: plan.removed, productIds: [...Object.keys(plan.removed), ...Object.keys(plan.added)],
        reason: String(reason || "").slice(0, 220), ticketId: null, actorUid: s.user.uid, at: serverTimestamp(),
      });
      t.update(balRef, { onHand: next, version: Number(bal.data().version) + 1, lastMovementId: id, updatedAt: serverTimestamp(), updatedBy: s.user.uid });
      return plan;
    });
  }

  // ---------- paste capture (+ offline queue) ----------
  async function submitPaste(item) {
    const fingerprint = D.pasteFingerprint(item.message, item.manager || D.MANAGER_PLACEHOLDER, item.site);
    const key = await sha256Hex(fingerprint);
    const parsed = D.parseWhatsApp(item.message);
    const lockRef = doc(db, "pasteLocks", key);
    return writeNewTicket(
      { status: "review", source: D.SOURCES.paste, manager: item.manager || D.MANAGER_PLACEHOLDER, phone: item.phone, site: item.site, rawMessage: item.message, lines: parsed.lines, reviewLines: parsed.unmatched, pasteKey: key },
      async (t) => {
        const lock = await t.get(lockRef);
        if (lock.exists()) {
          const l = lock.data();
          const at = l.at?.toMillis?.() ?? 0;
          if (l.requestId === item.requestId || Date.now() - at < D.DUPLICATE_WINDOW_MS) return { done: { ticketId: l.ticketId, duplicate: true } };
        }
        return { afterTicket: (tt, r) => tt.set(lockRef, { ticketId: r.ticketId, at: serverTimestamp(), by: s.user.uid, requestId: item.requestId }) };
      },
    );
  }

  let flushing = false;
  async function flushPending() {
    if (flushing || !isOnline() || s.authState !== "ready" || !isStaff()) return [];
    flushing = true;
    const done = [];
    try {
      for (const item of [...s.pending]) {
        try {
          const res = await submitPaste(item);
          done.push({ ...res, requestId: item.requestId });
          writePending(s.pending.filter((p) => p.requestId !== item.requestId));
        } catch (e) {
          if (e instanceof OfflineError) break;
          writePending(s.pending.map((p) => (p.requestId === item.requestId ? { ...p, error: e.message } : p)));
        }
      }
    } finally {
      flushing = false;
    }
    return done;
  }

  // ---------- public API ----------
  const api = {
    mode: "firebase",
    capabilities: { auth: true, shared: true, backupRestore: false, staffAdmin: true, legacyImport: true },
    UserError,
    OfflineError,

    init() {
      return new Promise((resolve) => {
        let first = true;
        onAuthStateChanged(auth, (u) => {
          s.authUser = u ? { uid: u.uid, email: u.email || "" } : null;
          s.pending = readPending();
          if (!u) {
            profileUnsub?.();
            profileUnsub = null;
            stopData();
            s.user = null;
            s.authState = "signed-out";
            s.ready = true;
            emit();
          } else {
            s.authState = "loading";
            emit();
            watchProfile(u);
          }
          if (first) {
            first = false;
            resolve({ ...s });
          }
        });
      });
    },
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...s });
      return () => listeners.delete(fn);
    },
    notifyConnectivity() {
      emit();
      if (isOnline()) flushPending().catch(() => {});
    },

    async signIn(email, password) {
      try {
        await signInWithEmailAndPassword(auth, String(email || "").trim(), String(password || ""));
      } catch (e) {
        throw friendlyError(e);
      }
    },
    async resetPassword(email) {
      try {
        await sendPasswordResetEmail(auth, String(email || "").trim());
      } catch (e) {
        throw friendlyError(e);
      }
    },
    async signOut() {
      stopData();
      await signOut(auth);
    },

    /** Paste = ticket. Online: committed ticket in "review". Offline: saved to this device's queue. */
    async capturePaste({ message, manager, phone, site }) {
      me();
      requireStaff();
      message = String(message || "").trim();
      if (!message) throw new UserError("Paste a WhatsApp order first.");
      if (message.length > D.MAX_MESSAGE) throw new UserError("This message is too long. Copy just the order.");
      const item = {
        requestId: newId("pasteLocks"),
        message,
        manager: String(manager || "").trim() || D.capturedManager(message),
        phone: String(phone || "").trim().slice(0, 30),
        site: String(site || "").trim().slice(0, 120),
        at: new Date().toISOString(),
      };
      // Same-device repeat while still waiting to sync.
      const queuedTwin = s.pending.find((p) => p.message === item.message && p.manager === item.manager && p.site === item.site && Date.now() - Date.parse(p.at) < D.DUPLICATE_WINDOW_MS);
      if (queuedTwin) return { queued: true, duplicate: true, requestId: queuedTwin.requestId };
      if (!isOnline()) {
        writePending([...s.pending, item]);
        return { queued: true, duplicate: false, requestId: item.requestId };
      }
      try {
        return await submitPaste(item);
      } catch (e) {
        if (e instanceof OfflineError) {
          writePending([...s.pending, item]);
          return { queued: true, duplicate: false, requestId: item.requestId };
        }
        throw e;
      }
    },
    retryPending: () => flushPending(),
    discardPending(requestId) {
      writePending(s.pending.filter((p) => p.requestId !== requestId));
    },

    async createTicket({ manager, phone, site, rawMessage, notes, lines, managerUid = null }) {
      me();
      requireStaff();
      manager = String(manager || "").trim();
      const combined = D.combineLines(lines);
      if (!D.isConfirmedManager(manager) || !combined.ok) throw new UserError("Enter a manager and one or more valid product quantities.");
      if (phone && !D.whatsappPhone(phone)) throw new UserError("Use a valid WhatsApp number, or leave the field empty.");
      return writeNewTicket({ status: "new", source: D.SOURCES.manual, manager, managerUid, phone, site, rawMessage, notes, lines: combined.lines });
    },

    /** Phase 2: a signed-in site manager orders directly in the app (no WhatsApp involved). */
    async createInAppOrder({ site, notes, lines }) {
      const u = me();
      if (u.role !== "site-manager") throw new UserError("Only site managers use the in-app order form.");
      const combined = D.combineLines(lines);
      if (!combined.ok) throw new UserError(combined.error);
      site = String(site || "");
      if (site && !(u.sites || []).includes(site)) throw new UserError("Choose one of your assigned sites.");
      return writeNewTicket({ status: "new", source: D.SOURCES.inApp, manager: u.displayName, managerUid: u.uid, phone: u.phone || "", site, notes, lines: combined.lines });
    },

    async reviewTicket(id, { manager, phone, site, notes, lines, managerUid }) {
      me();
      requireStaff();
      manager = String(manager || "").trim();
      if (!D.isConfirmedManager(manager)) throw new UserError("Enter the manager name.");
      if (phone && !D.whatsappPhone(phone)) throw new UserError("Correct the WhatsApp number or leave it blank.");
      const combined = D.combineLines(lines);
      if (!combined.ok) throw new UserError(combined.error);
      return ticketWrite(id, {
        write: (t, cur, raw) => {
          if (D.FINAL_STATUSES.includes(cur.status)) throw new UserError("Ticket cannot be edited.");
          const status = cur.status === "review" ? "new" : cur.status;
          const update = { manager, phone: phone || "", site: site || "", notes: notes || "", items: D.linesToItems(combined.lines), reviewLines: [], reviewedAt: serverTimestamp(), reviewedBy: s.user.uid, status };
          if (managerUid !== undefined) update.managerUid = managerUid || null;
          return { update, type: cur.status === "review" ? "ticket.confirmed" : "ticket.edited", summary: cur.status === "review" ? "Reviewed and confirmed" : "Ticket details edited", details: { from: cur.status, to: status } };
        },
      });
    },

    async changeStatus(id, status, { reason = "" } = {}) {
      me();
      requireStaff();
      return ticketWrite(id, {
        reads: async (t, cur) => {
          if (status !== "collected") return {};
          const balRef = doc(db, "inventory", "balances");
          const mvRef = doc(db, "stockMovements", id + "_collect");
          const [bal, mv] = [await t.get(balRef), await t.get(mvRef)];
          return { balRef, bal, mvRef, mvExists: mv.exists() };
        },
        write: (t, cur, raw, extra) => {
          const check = D.checkTransition(cur, status);
          if (!check.ok) throw new UserError(cur.status === status ? `Ticket is already ${D.STATUSES[status]}.` : check.error);
          const update = { status };
          let after = null;
          if (status === "collected") {
            if (extra.mvExists) throw new UserError("This ticket has already been issued.");
            if (!extra.bal.exists()) throw new UserError("The shared stock record is not set up yet.");
            const onHand = extra.bal.data().onHand || {};
            const plan = D.planCollection(onHand, cur.lines);
            if (!plan.ok) throw new UserError(plan.error);
            // Deduct exactly what the stored ticket says — never what the screen last showed.
            const removed = raw.items;
            const next = D.applyMovement(onHand, {}, removed);
            Object.assign(update, { collectedAt: serverTimestamp(), collectedBy: s.user.uid, collectionMovementId: extra.mvRef.id });
            after = (tt) => {
              tt.set(extra.mvRef, { kind: "collection", added: {}, removed, productIds: Object.keys(removed), reason: `Issued on ticket ${id}`, ticketId: id, actorUid: s.user.uid, at: serverTimestamp() });
              tt.update(extra.balRef, { onHand: next, version: Number(extra.bal.data().version) + 1, lastMovementId: extra.mvRef.id, updatedAt: serverTimestamp(), updatedBy: s.user.uid });
            };
          }
          if (status === "cancelled") Object.assign(update, { cancelledAt: serverTimestamp(), cancelledBy: s.user.uid, cancelReason: String(reason || "").slice(0, 300) });
          return { update, type: "ticket.status", summary: `${D.STATUSES[cur.status]} → ${D.STATUSES[status]}`, details: { from: cur.status, to: status }, after };
        },
      });
    },

    async adjustStock({ productId, mode, amount, reason }) {
      me();
      requireStaff();
      reason = String(reason || "").trim();
      if (!reason) throw new UserError("Enter a valid quantity and reason.");
      return stockMovement(mode === "count" ? "count" : mode === "in" ? "receive" : "write-off", (onHand) => D.planStockChange(onHand, productId, mode, amount), reason);
    },

    async convertStock({ source, count, reason }) {
      me();
      requireStaff();
      reason = String(reason || "").trim();
      if (!reason) throw new UserError("Enter a valid whole-container count and reference.");
      if (s.conversionsExists === false) throw new UserError("Pack conversions are not set up yet. An admin must run first-time setup in Settings.");
      return stockMovement("conversion", (onHand) => D.planConversion(onHand, source, count), reason);
    },

    async saveSettings({ company, lowThreshold }) {
      me();
      requireAdmin();
      if (!Number.isSafeInteger(lowThreshold) || lowThreshold < 0 || lowThreshold > 99999) throw new UserError("Alert threshold must be a whole number.");
      return tx(async (t) => {
        t.set(doc(db, "settings", "app"), { company: String(company || "").trim().slice(0, 90) || "Stock Control", lowThreshold, updatedAt: serverTimestamp(), updatedBy: s.user.uid });
      });
    },

    /** Admin: create the shared documents the app needs (idempotent; never overwrites balances). */
    async initialiseDatabase() {
      me();
      requireAdmin();
      return tx(async (t) => {
        const balRef = doc(db, "inventory", "balances");
        const appRef = doc(db, "settings", "app");
        const convRef = doc(db, "settings", "conversions");
        const [bal, app, conv] = [await t.get(balRef), await t.get(appRef), await t.get(convRef)];
        const productSnaps = [];
        for (const p of D.PRODUCTS) productSnaps.push(await t.get(doc(db, "products", p.id)));
        if (!bal.exists()) t.set(balRef, { onHand: {}, version: 0, lastMovementId: null, updatedAt: serverTimestamp(), updatedBy: s.user.uid });
        if (!app.exists()) t.set(appRef, { company: "Stock Control", lowThreshold: 2, updatedAt: serverTimestamp(), updatedBy: s.user.uid });
        if (!conv.exists())
          t.set(convRef, { pairs: Object.fromEntries(D.CONVERSIONS.map((c) => [c.source, { target: c.target, ratio: c.ratio }])), updatedAt: serverTimestamp(), updatedBy: s.user.uid });
        D.PRODUCTS.forEach((p, i) => {
          if (!productSnaps[i].exists())
            t.set(doc(db, "products", p.id), { name: p.name, size: p.size, group: p.group, unit: p.unit, img: p.img, active: true, sortOrder: i, updatedAt: serverTimestamp() });
        });
        return { created: { balances: !bal.exists(), settings: !app.exists(), conversions: !conv.exists(), products: productSnaps.filter((x) => !x.exists()).length } };
      });
    },

    /** Admin: create or update a staff/manager profile for an existing Firebase Auth user. */
    async saveUser(targetUid, { role, active, displayName, email = "", phone = "", sites = [] }) {
      me();
      requireAdmin();
      targetUid = String(targetUid || "").trim();
      if (!/^[A-Za-z0-9]{10,128}$/.test(targetUid)) throw new UserError("Paste the user's UID from Firebase Authentication.");
      if (!["admin", "stock-controller", "site-manager"].includes(role)) throw new UserError("Choose a role.");
      displayName = String(displayName || "").trim().slice(0, 100);
      if (!displayName) throw new UserError("Enter the person's name.");
      if (phone && !D.whatsappPhone(phone)) throw new UserError("Correct the WhatsApp number or leave it blank.");
      if (targetUid === s.user.uid && (role !== "admin" || active !== true)) throw new UserError("You cannot remove your own admin access.");
      const cleanSites = [...new Set((sites || []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean))].slice(0, 30);
      return tx(async (t) => {
        const ref = doc(db, "users", targetUid);
        const before = await t.get(ref);
        const auditId = audit(t, before.exists() ? "user.updated" : "user.created", "user", targetUid, `${displayName}: ${role}${active ? "" : " (inactive)"}`, {
          role, active: !!active, previousRole: before.exists() ? before.data().role : null, previousActive: before.exists() ? before.data().active : null,
        });
        t.set(ref, { role, active: !!active, displayName, email: String(email || "").slice(0, 200), phone: String(phone || "").slice(0, 30), sites: cleanSites, updatedAt: serverTimestamp(), updatedBy: s.user.uid, lastAuditId: auditId });
      });
    },

    /** Admin: compare a local-prototype JSON backup with the shared database before importing. */
    previewLegacyImport(backup) {
      requireAdmin();
      const ok = !!(backup && backup.schema === 1 && backup.counts && Array.isArray(backup.tickets));
      if (!ok) throw new UserError("This is not a valid Stock Control backup.");
      const existing = new Set(s.tickets.map((t) => t.id));
      const tickets = backup.tickets.map((t) => {
        const newId = "LEGACY-" + String(t.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
        const combined = D.combineLines((t.lines || []).filter((l) => D.product(l.productId)));
        const status = ["collected", "cancelled"].includes(t.status) ? t.status : "review";
        return { legacyId: t.id, newId, status, originalStatus: t.status, lines: combined.ok ? combined.lines : [], exists: existing.has(newId), raw: t };
      });
      const counts = D.PRODUCTS.map((p) => ({ productId: p.id, current: Number(s.counts[p.id] || 0), backup: Number.isSafeInteger(backup.counts[p.id]) && backup.counts[p.id] >= 0 ? backup.counts[p.id] : null }));
      return { tickets, counts, movements: Array.isArray(backup.movements) ? backup.movements.length : 0 };
    },

    /** Admin: import tickets (deterministic LEGACY- ids, so re-importing never duplicates) and,
     * optionally, set stock to the backup counts as one "import" movement. */
    async importLegacy(backup, { tickets = true, counts = false } = {}) {
      me();
      requireAdmin();
      const preview = api.previewLegacyImport(backup);
      const result = { imported: 0, skipped: 0, failed: [], countsSet: false };
      if (tickets) {
        for (const item of preview.tickets) {
          try {
            const created = await tx(async (t) => {
              const ref = doc(db, "tickets", item.newId);
              if ((await t.get(ref)).exists()) return false;
              const raw = item.raw;
              const auditId = audit(t, "ticket.imported", "ticket", item.newId, `Imported from local prototype (${item.legacyId}, was ${item.originalStatus})`, { originalStatus: String(item.originalStatus || "") });
              const note = item.status === "review" ? [`Imported from the local prototype (was ${D.STATUSES[item.originalStatus] || item.originalStatus}). Confirm before preparing.`] : [];
              t.set(ref, {
                ticketId: item.newId, seq: 0, day: "", status: item.status, source: D.SOURCES.legacy,
                manager: String(raw.manager || D.MANAGER_PLACEHOLDER).slice(0, 100), managerUid: null,
                phone: String(raw.phone || "").slice(0, 30), site: String(raw.site || "").slice(0, 120), notes: String(raw.notes || "").slice(0, 1500),
                rawMessage: String(raw.rawMessage || "").slice(0, 6000), items: D.linesToItems(item.lines),
                reviewLines: [...note, ...(Array.isArray(raw.reviewLines) ? raw.reviewLines.map(String).slice(0, 60) : [])],
                pasteKey: null, createdAt: serverTimestamp(), createdBy: s.user.uid, updatedAt: serverTimestamp(), updatedBy: s.user.uid,
                reviewedAt: null, reviewedBy: null, collectedAt: null, collectedBy: null, collectionMovementId: null,
                cancelledAt: null, cancelledBy: null, cancelReason: null, lastAuditId: auditId,
                legacyTicketId: String(item.legacyId || "").slice(0, 80), legacyCreatedAt: String(raw.createdAt || "").slice(0, 40),
              });
              return true;
            });
            created ? result.imported++ : result.skipped++;
          } catch (e) {
            result.failed.push({ id: item.legacyId, error: e.message });
          }
        }
      }
      if (counts) {
        const target = Object.fromEntries(preview.counts.filter((c) => c.backup !== null).map((c) => [c.productId, c.backup]));
        const mvId = "import-" + (await sha256Hex(JSON.stringify(target) + "|" + backup.nextTicket)).slice(0, 40);
        try {
          await stockMovement(
            "import",
            (onHand) => {
              const added = {}, removed = {};
              for (const [pid, q] of Object.entries(target)) {
                const diff = q - Number(onHand[pid] || 0);
                if (diff > 0) added[pid] = diff;
                if (diff < 0) removed[pid] = -diff;
              }
              if (!Object.keys(added).length && !Object.keys(removed).length) return { ok: false, error: "Stock already matches the backup counts." };
              return { ok: true, added, removed };
            },
            "Stock counts imported from local prototype backup",
            mvId,
          );
          result.countsSet = true;
        } catch (e) {
          result.failed.push({ id: "stock counts", error: e.message });
        }
      }
      return result;
    },

    _state: () => s,
  };
  return api;
}
