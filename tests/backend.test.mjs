// Firebase backend tests against the emulator — exercises the same backend-firebase.mjs the app uses,
// with two or more simulated devices working at the same time. Run: npm run test:rules
import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "firebase/firestore";
import { createFirebaseBackend } from "../backend-firebase.mjs";
import { makeEnv, seed, readDoc, countDocs, D } from "./emulator-helpers.mjs";

let env;
before(async () => (env = await makeEnv()));
after(async () => env?.cleanup());
beforeEach(async () => seed(env, { onHand: { mop: 3, "pine-gel-5l": 10, "black-bags": 10, "two-stroke-500ml": 10 } }));
const open = [];
afterEach(async () => {
  // Stop every simulated device's live listeners before the database is cleared for the next test.
  await Promise.all(open.splice(0).map((b) => b.signOut().catch(() => {})));
});

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

/** A "device": one signed-in person with their own Firestore client. */
async function device(uid, { online = () => true } = {}) {
  const db = env.authenticatedContext(uid).firestore();
  const sdk = { ...fs, onAuthStateChanged: (_auth, cb) => (setTimeout(() => cb({ uid, email: uid + "@example.test" }), 0), () => {}), signInWithEmailAndPassword: async () => {}, signOut: async () => {}, sendPasswordResetEmail: async () => {} };
  const b = createFirebaseBackend({ sdk, domain: D, auth: {}, db, storage: memoryStorage(), isOnline: online, timeoutMs: 20000 });
  open.push(b);
  await b.init();
  await waitFor(b, (s) => s.authState === "ready" && s.settingsExists !== null && (s.user?.role === "site-manager" || s.balancesExists !== null));
  return b;
}
async function waitFor(b, pred, ms = 8000) {
  const start = Date.now();
  while (!pred(b._state())) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for state: " + JSON.stringify({ authState: b._state().authState, error: b._state().error }));
    await new Promise((r) => setTimeout(r, 25));
  }
  return b._state();
}

test("paste creates a persisted review ticket instantly, with original text and a unique id", async () => {
  const ctrl = await device("ctrl");
  const msg = "2 x Pine Gel 5L\n4 x Two-Stroke Oil 500ml\n3 x Black Bags\nalso the thing we discussed";
  const res = await ctrl.capturePaste({ message: msg, manager: "", phone: "", site: "Complex A" });
  assert.equal(res.duplicate, false);
  assert.match(res.ticketId, /^SC-\d{8}-0001$/);
  const t = await readDoc(env, "tickets/" + res.ticketId);
  assert.equal(t.status, "review");
  assert.equal(t.source, "manual-whatsapp-paste");
  assert.equal(t.rawMessage, msg);
  assert.deepEqual(t.items, { "pine-gel-5l": 2, "two-stroke-500ml": 4, "black-bags": 3 });
  assert.deepEqual(t.reviewLines, ["also the thing we discussed"]);
  assert.equal(t.manager, D.MANAGER_PLACEHOLDER);
  assert.ok(t.createdAt && t.createdBy === "ctrl");
  const audit = await readDoc(env, "auditLogs/" + t.lastAuditId);
  assert.equal(audit.type, "ticket.created");
});

test("an accidental repeated paste does not create a duplicate, even from a second device", async () => {
  const a = await device("ctrl");
  const b = await device("ctrl2");
  const msg = "3 x Black Bags";
  const first = await a.capturePaste({ message: msg, manager: "Thabo", phone: "", site: "" });
  const again = await a.capturePaste({ message: msg, manager: "Thabo", phone: "", site: "" });
  const other = await b.capturePaste({ message: msg, manager: "Thabo", phone: "", site: "" });
  assert.equal(again.duplicate, true);
  assert.equal(other.duplicate, true);
  assert.equal(again.ticketId, first.ticketId);
  assert.equal(other.ticketId, first.ticketId);
  assert.equal(await countDocs(env, "tickets"), 1);
  // A different message is a new ticket.
  const different = await a.capturePaste({ message: "1 x mop", manager: "Thabo", phone: "", site: "" });
  assert.equal(different.duplicate, false);
  assert.notEqual(different.ticketId, first.ticketId);
});

test("unknown products / text-only messages still produce a reviewable ticket", async () => {
  const ctrl = await device("ctrl");
  const res = await ctrl.capturePaste({ message: "Hi, please send the usual stuff", manager: "", phone: "", site: "" });
  const t = await readDoc(env, "tickets/" + res.ticketId);
  assert.equal(t.status, "review");
  assert.deepEqual(t.items, {});
  assert.deepEqual(t.reviewLines, ["Hi, please send the usual stuff"]);
  await assert.rejects(ctrl.changeStatus(res.ticketId, "preparing"), /not allowed/);
  await assert.rejects(ctrl.reviewTicket(res.ticketId, { manager: "Thabo", lines: [] }), /at least one/);
});

test("concurrent pastes on many devices get unique sequential ticket numbers", async () => {
  const devices = await Promise.all(["ctrl", "ctrl2", "admin"].map((u) => device(u)));
  const results = await Promise.all(devices.flatMap((d, i) => [0, 1, 2].map((j) => d.capturePaste({ message: `${j + 1} x mop (device ${i}, order ${j})`, manager: "M", phone: "", site: "" }))));
  const ids = results.map((r) => r.ticketId);
  assert.equal(new Set(ids).size, 9, "all ticket ids unique");
  const seqs = ids.map((id) => Number(id.slice(-4))).sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("review → confirm → prepare → ready → collected; stock deducted only on collection, exactly once", async () => {
  const ctrl = await device("ctrl");
  const { ticketId } = await ctrl.capturePaste({ message: "2 x mop", manager: "", phone: "", site: "" });
  await ctrl.reviewTicket(ticketId, { manager: "Thabo", phone: "", site: "Complex A", notes: "", lines: [{ productId: "mop", quantity: 2 }] });
  assert.equal((await readDoc(env, "tickets/" + ticketId)).status, "new");
  await ctrl.changeStatus(ticketId, "preparing");
  await ctrl.changeStatus(ticketId, "ready");
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 3, "no deduction before collection");
  await ctrl.changeStatus(ticketId, "collected");
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 1);
  await assert.rejects(ctrl.changeStatus(ticketId, "collected"), /already/);
  await assert.rejects(ctrl.changeStatus(ticketId, "cancelled"));
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 1);
  const mv = await readDoc(env, `stockMovements/${ticketId}_collect`);
  assert.deepEqual(mv.removed, { mop: 2 });
});

test("two devices collecting the same ticket at the same moment: one issue only", async () => {
  const a = await device("ctrl");
  const b = await device("ctrl2");
  const { ticketId } = await a.createTicket({ manager: "Thabo", phone: "", site: "", rawMessage: "", notes: "", lines: [{ productId: "mop", quantity: 2 }] });
  await a.changeStatus(ticketId, "ready");
  await waitFor(b, (s) => s.tickets.some((t) => t.id === ticketId && t.status === "ready"));
  const outcomes = await Promise.allSettled([a.changeStatus(ticketId, "collected"), b.changeStatus(ticketId, "collected")]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1, JSON.stringify(outcomes.map((o) => o.reason?.message)));
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 1);
  assert.equal((await readDoc(env, "tickets/" + ticketId)).status, "collected");
});

test("two tickets competing for the last stock: never negative, the loser stays ready", async () => {
  const a = await device("ctrl");
  const b = await device("ctrl2");
  const t1 = (await a.createTicket({ manager: "Thabo", phone: "", site: "", rawMessage: "", notes: "", lines: [{ productId: "mop", quantity: 2 }] })).ticketId;
  const t2 = (await b.createTicket({ manager: "Lindiwe", phone: "", site: "", rawMessage: "", notes: "", lines: [{ productId: "mop", quantity: 2 }] })).ticketId;
  await a.changeStatus(t1, "ready");
  await b.changeStatus(t2, "ready");
  const outcomes = await Promise.allSettled([a.changeStatus(t1, "collected"), b.changeStatus(t2, "collected")]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const loser = outcomes.find((o) => o.status === "rejected");
  assert.match(loser.reason.message, /Not enough stock/);
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 1);
  const statuses = [(await readDoc(env, "tickets/" + t1)).status, (await readDoc(env, "tickets/" + t2)).status].sort();
  assert.deepEqual(statuses, ["collected", "ready"]);
});

test("concurrent stock receipts on several devices lose no history", async () => {
  const devices = await Promise.all(["ctrl", "ctrl2", "admin"].map((u) => device(u)));
  await Promise.all(devices.flatMap((d) => [1, 2, 3].map((n) => d.adjustStock({ productId: "black-bags", mode: "in", amount: n, reason: "Delivery" }))));
  const bal = await readDoc(env, "inventory/balances");
  assert.equal(bal.onHand["black-bags"], 10 + 3 * (1 + 2 + 3));
  assert.equal(bal.version, 9);
  assert.equal(await countDocs(env, "stockMovements"), 9);
});

test("write-off, exact count and conversion keep balances consistent", async () => {
  const ctrl = await device("ctrl");
  await assert.rejects(ctrl.adjustStock({ productId: "mop", mode: "out", amount: 4, reason: "Damaged" }), /more than is available/);
  await ctrl.adjustStock({ productId: "mop", mode: "out", amount: 1, reason: "Damaged" });
  await ctrl.adjustStock({ productId: "mop", mode: "count", amount: 7, reason: "Stocktake" });
  await ctrl.adjustStock({ productId: "pine-gel-20l", mode: "in", amount: 2, reason: "Delivery" });
  await ctrl.convertStock({ source: "pine-gel-20l", count: 1, reason: "Inventory conversion" });
  const bal = (await readDoc(env, "inventory/balances")).onHand;
  assert.equal(bal.mop, 7);
  assert.equal(bal["pine-gel-20l"], 1);
  assert.equal(bal["pine-gel-5l"], 14);
});

test("managers cannot process tickets or stock; in-app order creates a ticket automatically", async () => {
  const mgr = await device("mgr");
  await assert.rejects(mgr.adjustStock({ productId: "mop", mode: "in", amount: 1, reason: "x" }), /Only stock controllers/);
  const { ticketId } = await mgr.createInAppOrder({ site: "Complex A", notes: "", lines: [{ productId: "mop", quantity: 1 }] });
  const t = await readDoc(env, "tickets/" + ticketId);
  assert.equal(t.status, "new");
  assert.equal(t.source, "in-app-order");
  assert.equal(t.managerUid, "mgr");
  await waitFor(mgr, (s) => s.tickets.some((x) => x.id === ticketId));
  assert.ok(mgr._state().tickets.every((x) => x.managerUid === "mgr"), "manager only receives their own tickets");
  assert.equal(mgr._state().movements.length, 0);
  const ctrl = await device("ctrl");
  await waitFor(ctrl, (s) => s.tickets.some((x) => x.id === ticketId));
});

test("offline paste is queued on the device (not reported as a ticket) and submitted on reconnect", async () => {
  let online = false;
  const ctrl = await device("ctrl", { online: () => online });
  const res = await ctrl.capturePaste({ message: "2 x mop", manager: "Thabo", phone: "", site: "" });
  assert.equal(res.queued, true);
  assert.equal(res.ticketId, undefined);
  assert.equal(ctrl._state().pending.length, 1);
  assert.equal(await countDocs(env, "tickets"), 0);
  await assert.rejects(ctrl.adjustStock({ productId: "mop", mode: "in", amount: 1, reason: "x" }), /offline/i);
  online = true;
  const done = await ctrl.retryPending();
  assert.equal(done.length, 1);
  assert.equal(ctrl._state().pending.length, 0);
  assert.equal(await countDocs(env, "tickets"), 1);
  // Retrying the same queued request again can never create a second ticket.
  const t = await readDoc(env, "tickets/" + done[0].ticketId);
  assert.equal(t.rawMessage, "2 x mop");
});

test("admin setup is idempotent and never resets stock", async () => {
  const admin = await device("admin");
  const res = await admin.initialiseDatabase();
  assert.equal(res.created.balances, false);
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 3);
  assert.equal(await countDocs(env, "products"), 16);
});

test("admin import of a prototype backup: reviewed, no duplicates on re-import", async () => {
  const admin = await device("admin");
  const backup = {
    schema: 1, nextTicket: 4, settings: {}, movements: [],
    counts: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, p.id === "mop" ? 9 : 0])),
    tickets: [
      { id: "SC-20261101-0001", manager: "Thabo", site: "", phone: "", notes: "", rawMessage: "2 x mop", lines: [{ productId: "mop", quantity: 2 }], status: "ready", createdAt: "2026-11-01T08:00:00Z" },
      { id: "SC-20261101-0002", manager: "Thabo", site: "", phone: "", notes: "", lines: [{ productId: "mop", quantity: 1 }], status: "collected", createdAt: "2026-11-01T09:00:00Z" },
    ],
  };
  const first = await admin.importLegacy(backup, { tickets: true, counts: true });
  assert.deepEqual([first.imported, first.skipped, first.failed.length, first.countsSet], [2, 0, 0, true]);
  assert.equal((await readDoc(env, "tickets/LEGACY-SC-20261101-0001")).status, "review", "open tickets come in as Needs review");
  assert.equal((await readDoc(env, "tickets/LEGACY-SC-20261101-0002")).status, "collected");
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 9);
  const again = await admin.importLegacy(backup, { tickets: true, counts: true });
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 2);
  assert.equal(again.countsSet, false);
  assert.equal(await countDocs(env, "tickets"), 2);
});
