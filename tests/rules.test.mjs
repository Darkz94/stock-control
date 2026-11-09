// Firestore security rules tests — run with the emulator: npm run test:rules
// Each "tamper" test is a write that a modified client could attempt; the rules must refuse it.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, orderBy, serverTimestamp } from "firebase/firestore";
import { makeEnv, seed, seedTicket, readDoc } from "./emulator-helpers.mjs";

let env;
before(async () => (env = await makeEnv()));
after(async () => env?.cleanup());
beforeEach(async () => seed(env, { onHand: { mop: 5, "pine-gel-20l": 2, "pine-gel-5l": 0 } }));

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const auditDoc = (db, id, uid, targetType, targetId) => [doc(db, "auditLogs", id), { type: "test", targetType, targetId, actorUid: uid, at: serverTimestamp(), summary: "test", details: {} }];

/** Build the full, valid set of writes that collects `ticketId` (items {mop:2}) with mop going 5 -> 3. */
function collectionBatch(db, uid, ticketId, { removed = { mop: 2 }, onHand = { mop: 3, "pine-gel-20l": 2, "pine-gel-5l": 0 }, mvId = ticketId + "_collect", auditId = "audit-collect-" + ticketId, skip = [] } = {}) {
  const b = writeBatch(db);
  if (!skip.includes("ticket"))
    b.update(doc(db, "tickets", ticketId), { status: "collected", collectedAt: serverTimestamp(), collectedBy: uid, collectionMovementId: ticketId + "_collect", updatedAt: serverTimestamp(), updatedBy: uid, lastAuditId: auditId });
  if (!skip.includes("movement"))
    b.set(doc(db, "stockMovements", mvId), { kind: "collection", added: {}, removed, productIds: Object.keys(removed), reason: "Issued", ticketId, actorUid: uid, at: serverTimestamp() });
  if (!skip.includes("balances")) b.update(doc(db, "inventory", "balances"), { onHand, version: 1, lastMovementId: mvId, updatedAt: serverTimestamp(), updatedBy: uid });
  if (!skip.includes("audit")) b.set(...auditDoc(db, auditId, uid, "ticket", ticketId));
  return b;
}

// ---------------------------------------------------------------- identity & roles
test("signed-out users and users without a profile can read nothing", async () => {
  await assertFails(getDoc(doc(anon(), "inventory", "balances")));
  await assertFails(getDoc(doc(as("stranger"), "inventory", "balances")));
  await assertFails(getDocs(collection(as("stranger"), "tickets")));
  await assertSucceeds(getDoc(doc(as("stranger"), "users", "stranger"))); // own (missing) profile -> "waiting for access" screen
});

test("disabled staff lose all access", async () => {
  await assertFails(getDoc(doc(as("gone"), "inventory", "balances")));
  await assertFails(getDocs(collection(as("gone"), "tickets")));
});

test("nobody can grant themselves a role; only admins manage users", async () => {
  const db = as("ctrl");
  await assertFails(setDoc(doc(db, "users", "ctrl"), { role: "admin", active: true, displayName: "Cara", email: "", phone: "", sites: [], updatedAt: serverTimestamp(), updatedBy: "ctrl", lastAuditId: "aaaaaaaa1" }));
  await assertFails(setDoc(doc(as("stranger"), "users", "stranger"), { role: "admin", active: true, displayName: "X", email: "", phone: "", sites: [], updatedAt: serverTimestamp(), updatedBy: "stranger", lastAuditId: "aaaaaaaa2" }));
  // Admin can add a person, with an audit entry in the same write.
  const adb = as("admin");
  const b = writeBatch(adb);
  b.set(doc(adb, "users", "newperson123"), { role: "stock-controller", active: true, displayName: "New Person", email: "", phone: "", sites: [], updatedAt: serverTimestamp(), updatedBy: "admin", lastAuditId: "audit-user-1" });
  b.set(...auditDoc(adb, "audit-user-1", "admin", "user", "newperson123"));
  await assertSucceeds(b.commit());
  // Without the audit entry the same change is refused.
  await assertFails(setDoc(doc(adb, "users", "newperson456"), { role: "stock-controller", active: true, displayName: "No Audit", email: "", phone: "", sites: [], updatedAt: serverTimestamp(), updatedBy: "admin", lastAuditId: "audit-user-missing" }));
});

test("an admin cannot demote or disable themselves (no lock-out)", async () => {
  const adb = as("admin");
  const b = writeBatch(adb);
  b.set(doc(adb, "users", "admin"), { role: "stock-controller", active: true, displayName: "Ada", email: "", phone: "", sites: [], updatedAt: serverTimestamp(), updatedBy: "admin", lastAuditId: "audit-self-1" });
  b.set(...auditDoc(adb, "audit-self-1", "admin", "user", "admin"));
  await assertFails(b.commit());
});

test("staff can read user profiles; managers can read only their own", async () => {
  await assertSucceeds(getDocs(collection(as("ctrl"), "users")));
  await assertSucceeds(getDoc(doc(as("mgr"), "users", "mgr")));
  await assertFails(getDoc(doc(as("mgr"), "users", "mgr2")));
  await assertFails(getDocs(collection(as("mgr"), "users")));
});

// ---------------------------------------------------------------- stock balances
test("managers cannot read or edit stock balances or movements", async () => {
  await assertFails(getDoc(doc(as("mgr"), "inventory", "balances")));
  await assertFails(getDocs(collection(as("mgr"), "stockMovements")));
  await assertFails(updateDoc(doc(as("mgr"), "inventory", "balances"), { onHand: { mop: 999 } }));
});

test("balances cannot change without a matching new movement in the same write", async () => {
  const db = as("ctrl");
  await assertFails(updateDoc(doc(db, "inventory", "balances"), { onHand: { mop: 50, "pine-gel-20l": 2, "pine-gel-5l": 0 }, version: 1, lastMovementId: "fake-movement-1", updatedAt: serverTimestamp(), updatedBy: "ctrl" }));
  // Movement says +5 but balance claims +45: refused.
  const b = writeBatch(db);
  b.set(doc(db, "stockMovements", "mv-receive-1"), { kind: "receive", added: { mop: 5 }, removed: {}, productIds: ["mop"], reason: "Delivery", ticketId: null, actorUid: "ctrl", at: serverTimestamp() });
  b.update(doc(db, "inventory", "balances"), { onHand: { mop: 50, "pine-gel-20l": 2, "pine-gel-5l": 0 }, version: 1, lastMovementId: "mv-receive-1", updatedAt: serverTimestamp(), updatedBy: "ctrl" });
  await assertFails(b.commit());
});

test("a correct receive succeeds and the movement is immutable afterwards", async () => {
  const db = as("ctrl");
  const b = writeBatch(db);
  b.set(doc(db, "stockMovements", "mv-receive-2"), { kind: "receive", added: { mop: 5 }, removed: {}, productIds: ["mop"], reason: "Delivery", ticketId: null, actorUid: "ctrl", at: serverTimestamp() });
  b.update(doc(db, "inventory", "balances"), { onHand: { mop: 10, "pine-gel-20l": 2, "pine-gel-5l": 0 }, version: 1, lastMovementId: "mv-receive-2", updatedAt: serverTimestamp(), updatedBy: "ctrl" });
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(doc(db, "stockMovements", "mv-receive-2"), { reason: "changed" }));
  await assertFails(deleteDoc(doc(db, "stockMovements", "mv-receive-2")));
  // Re-using an old movement id to replay the change is refused.
  await assertFails(updateDoc(doc(db, "inventory", "balances"), { onHand: { mop: 15, "pine-gel-20l": 2, "pine-gel-5l": 0 }, version: 2, lastMovementId: "mv-receive-2", updatedAt: serverTimestamp(), updatedBy: "ctrl" }));
});

test("stock can never be written below zero", async () => {
  const db = as("ctrl");
  const b = writeBatch(db);
  b.set(doc(db, "stockMovements", "mv-off-1"), { kind: "write-off", added: {}, removed: { mop: 6 }, productIds: ["mop"], reason: "Damaged", ticketId: null, actorUid: "ctrl", at: serverTimestamp() });
  b.update(doc(db, "inventory", "balances"), { onHand: { mop: -1, "pine-gel-20l": 2, "pine-gel-5l": 0 }, version: 1, lastMovementId: "mv-off-1", updatedAt: serverTimestamp(), updatedBy: "ctrl" });
  await assertFails(b.commit());
});

test("movements cannot be backdated or signed as someone else", async () => {
  const db = as("ctrl");
  const b = writeBatch(db);
  b.set(doc(db, "stockMovements", "mv-forged-1"), { kind: "receive", added: { mop: 1 }, removed: {}, productIds: ["mop"], reason: "x", ticketId: null, actorUid: "admin", at: serverTimestamp() });
  b.update(doc(db, "inventory", "balances"), { onHand: { mop: 6, "pine-gel-20l": 2, "pine-gel-5l": 0 }, version: 1, lastMovementId: "mv-forged-1", updatedAt: serverTimestamp(), updatedBy: "ctrl" });
  await assertFails(b.commit());
});

test("conversions must use the configured ratio", async () => {
  const db = as("ctrl");
  const good = writeBatch(db);
  good.set(doc(db, "stockMovements", "mv-conv-1"), { kind: "conversion", added: { "pine-gel-5l": 4 }, removed: { "pine-gel-20l": 1 }, productIds: ["pine-gel-20l", "pine-gel-5l"], reason: "Repack batch", ticketId: null, actorUid: "ctrl", at: serverTimestamp() });
  good.update(doc(db, "inventory", "balances"), { onHand: { mop: 5, "pine-gel-20l": 1, "pine-gel-5l": 4 }, version: 1, lastMovementId: "mv-conv-1", updatedAt: serverTimestamp(), updatedBy: "ctrl" });
  await assertSucceeds(good.commit());
  const bad = writeBatch(db);
  bad.set(doc(db, "stockMovements", "mv-conv-2"), { kind: "conversion", added: { "pine-gel-5l": 10 }, removed: { "pine-gel-20l": 1 }, productIds: ["pine-gel-20l", "pine-gel-5l"], reason: "Repack batch", ticketId: null, actorUid: "ctrl", at: serverTimestamp() });
  bad.update(doc(db, "inventory", "balances"), { onHand: { mop: 5, "pine-gel-20l": 0, "pine-gel-5l": 14 }, version: 2, lastMovementId: "mv-conv-2", updatedAt: serverTimestamp(), updatedBy: "ctrl" });
  await assertFails(bad.commit());
});

// ---------------------------------------------------------------- collection
test("collection succeeds once with the exact ticket items", async () => {
  await seedTicket(env, "SC-20261109-0001");
  await assertSucceeds(collectionBatch(as("ctrl"), "ctrl", "SC-20261109-0001").commit());
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 3);
  // Second attempt (another device, stale screen) is refused.
  await assertFails(collectionBatch(as("ctrl2"), "ctrl2", "SC-20261109-0001", { onHand: { mop: 1, "pine-gel-20l": 2, "pine-gel-5l": 0 }, auditId: "audit-collect-again" }).commit());
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 3);
});

test("collection is refused if any part is missing or altered", async () => {
  await seedTicket(env, "SC-20261109-0002");
  const id = "SC-20261109-0002";
  await assertFails(collectionBatch(as("ctrl"), "ctrl", id, { skip: ["movement"] }).commit()); // status flip without stock movement
  await assertFails(collectionBatch(as("ctrl"), "ctrl", id, { skip: ["balances"] }).commit()); // movement without balance change
  await assertFails(collectionBatch(as("ctrl"), "ctrl", id, { skip: ["ticket"] }).commit()); // stock taken without closing ticket
  await assertFails(collectionBatch(as("ctrl"), "ctrl", id, { skip: ["audit"] }).commit()); // no audit entry
  await assertFails(collectionBatch(as("ctrl"), "ctrl", id, { removed: { mop: 1 }, onHand: { mop: 4, "pine-gel-20l": 2, "pine-gel-5l": 0 } }).commit()); // under-deduct
  await assertFails(collectionBatch(as("ctrl"), "ctrl", id, { mvId: "random-movement-id" }).commit()); // non-deterministic id
  await assertFails(collectionBatch(as("mgr"), "mgr", id).commit()); // managers cannot issue stock
  assert.equal((await readDoc(env, "tickets/" + id)).status, "ready");
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 5);
});

test("review / new / preparing tickets cannot be collected", async () => {
  for (const [i, status] of ["review", "new", "preparing"].entries()) {
    const id = "SC-20261109-001" + i;
    await seedTicket(env, id, { status });
    await assertFails(collectionBatch(as("ctrl"), "ctrl", id, { auditId: "audit-c-" + i }).commit());
  }
});

test("collected and cancelled tickets are frozen; tickets cannot be deleted", async () => {
  await seedTicket(env, "SC-20261109-0020", { status: "collected" });
  await seedTicket(env, "SC-20261109-0021", { status: "cancelled" });
  const db = as("ctrl");
  for (const id of ["SC-20261109-0020", "SC-20261109-0021"]) {
    const b = writeBatch(db);
    b.update(doc(db, "tickets", id), { status: "ready", updatedAt: serverTimestamp(), updatedBy: "ctrl", lastAuditId: "audit-unfreeze-" + id.slice(-2) });
    b.set(...auditDoc(db, "audit-unfreeze-" + id.slice(-2), "ctrl", "ticket", id));
    await assertFails(b.commit());
    await assertFails(deleteDoc(doc(db, "tickets", id)));
  }
});

// ---------------------------------------------------------------- ticket lifecycle
function statusBatch(db, uid, id, status, auditId, extra = {}) {
  const b = writeBatch(db);
  b.update(doc(db, "tickets", id), { status, updatedAt: serverTimestamp(), updatedBy: uid, lastAuditId: auditId, ...extra });
  b.set(...auditDoc(db, auditId, uid, "ticket", id));
  return b;
}

test("review tickets cannot be prepared or marked ready, only confirmed or cancelled", async () => {
  await seedTicket(env, "SC-20261109-0030", { status: "review", source: "manual-whatsapp-paste", manager: "Manager not specified", rawMessage: "2 x mop", reviewLines: ["Quantity assumed as 1 — confirm: mop"] });
  const db = as("ctrl");
  const id = "SC-20261109-0030";
  await assertFails(statusBatch(db, "ctrl", id, "preparing", "audit-r-1").commit());
  await assertFails(statusBatch(db, "ctrl", id, "ready", "audit-r-2").commit());
  // Confirming without a real manager name is refused.
  const bad = writeBatch(db);
  bad.update(doc(db, "tickets", id), { status: "new", reviewLines: [], reviewedAt: serverTimestamp(), reviewedBy: "ctrl", updatedAt: serverTimestamp(), updatedBy: "ctrl", lastAuditId: "audit-r-3" });
  bad.set(...auditDoc(db, "audit-r-3", "ctrl", "ticket", id));
  await assertFails(bad.commit());
  // Proper confirmation: manager + products, unmatched text resolved, same ticket.
  const good = writeBatch(db);
  good.update(doc(db, "tickets", id), { manager: "Thabo", items: { mop: 2 }, status: "new", reviewLines: [], reviewedAt: serverTimestamp(), reviewedBy: "ctrl", updatedAt: serverTimestamp(), updatedBy: "ctrl", lastAuditId: "audit-r-4" });
  good.set(...auditDoc(db, "audit-r-4", "ctrl", "ticket", id));
  await assertSucceeds(good.commit());
  await assertSucceeds(statusBatch(db, "ctrl", id, "preparing", "audit-r-5").commit());
  await assertSucceeds(statusBatch(db, "ctrl", id, "ready", "audit-r-6").commit());
  const t = await readDoc(env, "tickets/" + id);
  assert.equal(t.rawMessage, "2 x mop", "original message retained");
});

test("the original message, source and creation stamp can never be edited", async () => {
  await seedTicket(env, "SC-20261109-0040", { status: "new", rawMessage: "original text", source: "manual-whatsapp-paste" });
  const db = as("ctrl");
  const b = writeBatch(db);
  b.update(doc(db, "tickets", "SC-20261109-0040"), { rawMessage: "rewritten", reviewedAt: serverTimestamp(), reviewedBy: "ctrl", updatedAt: serverTimestamp(), updatedBy: "ctrl", lastAuditId: "audit-e-1" });
  b.set(...auditDoc(db, "audit-e-1", "ctrl", "ticket", "SC-20261109-0040"));
  await assertFails(b.commit());
});

test("cancelling an active ticket does not need or allow stock changes", async () => {
  await seedTicket(env, "SC-20261109-0050", { status: "ready" });
  const db = as("ctrl");
  await assertSucceeds(statusBatch(db, "ctrl", "SC-20261109-0050", "cancelled", "audit-x-1", { cancelledAt: serverTimestamp(), cancelledBy: "ctrl", cancelReason: "" }).commit());
  assert.equal((await readDoc(env, "inventory/balances")).onHand.mop, 5);
});

function newTicketBatch(db, uid, { id = "SC-20261109-0001", seq = 1, counterNext = 1, status = "review", source = "manual-whatsapp-paste", manager = "Manager not specified", managerUid = null, rawMessage = "2 x mop", items = {}, site = "", auditId = "audit-new-1", counter = true } = {}) {
  const b = writeBatch(db);
  if (counter) b.set(doc(db, "counters", "tickets-20261109"), { next: counterNext, updatedAt: serverTimestamp() });
  b.set(doc(db, "tickets", id), {
    ticketId: id, seq, day: "20261109", status, source, manager, managerUid, phone: "", site, notes: "", rawMessage, items, reviewLines: [], pasteKey: null,
    createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid, reviewedAt: null, reviewedBy: null, collectedAt: null, collectedBy: null,
    collectionMovementId: null, cancelledAt: null, cancelledBy: null, cancelReason: null, lastAuditId: auditId,
  });
  b.set(...auditDoc(db, auditId, uid, "ticket", id));
  return b;
}

test("pasted tickets are created in review with a sequential, unique number", async () => {
  const db = as("ctrl");
  await assertSucceeds(newTicketBatch(db, "ctrl").commit());
  // Reusing the same number (or skipping the counter) is refused.
  await assertFails(newTicketBatch(db, "ctrl", { auditId: "audit-new-2" }).commit());
  await assertFails(newTicketBatch(db, "ctrl", { id: "SC-20261109-0005", seq: 5, counterNext: 5, auditId: "audit-new-3" }).commit());
  await assertFails(newTicketBatch(db, "ctrl", { id: "SC-20261109-0002", seq: 2, counter: false, auditId: "audit-new-4" }).commit());
  await assertSucceeds(newTicketBatch(db, "ctrl", { id: "SC-20261109-0002", seq: 2, counterNext: 2, auditId: "audit-new-5" }).commit());
  // A pasted ticket must start in review and keep the raw text.
  await assertFails(newTicketBatch(db, "ctrl", { id: "SC-20261109-0003", seq: 3, counterNext: 3, status: "new", manager: "Thabo", items: { mop: 1 }, auditId: "audit-new-6" }).commit());
  await assertFails(newTicketBatch(db, "ctrl", { id: "SC-20261109-0003", seq: 3, counterNext: 3, rawMessage: "", auditId: "audit-new-7" }).commit());
});

// ---------------------------------------------------------------- managers (Phase 2) & privacy
test("managers see only their own tickets and cannot change them", async () => {
  await seedTicket(env, "SC-20261109-0060", { managerUid: "mgr", status: "new" });
  await seedTicket(env, "SC-20261109-0061", { managerUid: "mgr2", status: "new", phone: "0820000000" });
  const db = as("mgr");
  await assertSucceeds(getDoc(doc(db, "tickets", "SC-20261109-0060")));
  await assertFails(getDoc(doc(db, "tickets", "SC-20261109-0061")));
  await assertSucceeds(getDocs(query(collection(db, "tickets"), where("managerUid", "==", "mgr"), orderBy("createdAt", "desc"))));
  await assertFails(getDocs(query(collection(db, "tickets"), orderBy("createdAt", "desc"))));
  await assertFails(statusBatch(db, "mgr", "SC-20261109-0060", "cancelled", "audit-m-1", { cancelledAt: serverTimestamp(), cancelledBy: "mgr", cancelReason: "" }).commit());
  await assertFails(getDocs(collection(db, "auditLogs")));
  await assertFails(getDocs(collection(db, "pasteLocks")));
});

test("managers can submit an in-app order only for themselves and their sites", async () => {
  const db = as("mgr");
  const base = { status: "new", source: "in-app-order", manager: "Thabo Manager", managerUid: "mgr", rawMessage: "", items: { mop: 1 } };
  await assertFails(newTicketBatch(db, "mgr", { ...base, managerUid: "mgr2", auditId: "audit-io-1" }).commit());
  await assertFails(newTicketBatch(db, "mgr", { ...base, manager: "Someone Else", auditId: "audit-io-2" }).commit());
  await assertFails(newTicketBatch(db, "mgr", { ...base, site: "Complex B", auditId: "audit-io-3" }).commit());
  await assertFails(newTicketBatch(db, "mgr", { ...base, status: "ready", auditId: "audit-io-4" }).commit());
  await assertSucceeds(newTicketBatch(db, "mgr", { ...base, site: "Complex A", auditId: "audit-io-5" }).commit());
});

test("audit logs are append-only and readable by staff only", async () => {
  await seedTicket(env, "SC-20261109-0070", { status: "new" });
  const db = as("ctrl");
  await assertSucceeds(statusBatch(db, "ctrl", "SC-20261109-0070", "preparing", "audit-a-1").commit());
  await assertFails(updateDoc(doc(db, "auditLogs", "audit-a-1"), { summary: "edited" }));
  await assertFails(deleteDoc(doc(db, "auditLogs", "audit-a-1")));
  // A free-floating audit entry not tied to a ticket/user write is refused.
  await assertFails(setDoc(...auditDoc(db, "audit-orphan-1", "ctrl", "ticket", "SC-20261109-0070")));
});

test("settings and products are admin-only", async () => {
  await assertFails(setDoc(doc(as("ctrl"), "settings", "app"), { company: "X", lowThreshold: 1, updatedAt: serverTimestamp(), updatedBy: "ctrl" }));
  await assertSucceeds(setDoc(doc(as("admin"), "settings", "app"), { company: "X", lowThreshold: 1, updatedAt: serverTimestamp(), updatedBy: "admin" }));
  await assertFails(setDoc(doc(as("admin"), "settings", "secrets"), { apiKey: "nope" }));
  await assertSucceeds(getDoc(doc(as("mgr"), "settings", "app")));
});
