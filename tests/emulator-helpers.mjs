// Shared setup for emulator tests. Requires the Firestore emulator (npm run test:rules starts it).
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const D = require("../domain.js");
export const PROJECT = "demo-stock-control";

export async function makeEnv() {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
  return initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host, port: Number(port) },
  });
}

export const PEOPLE = {
  admin: { role: "admin", displayName: "Ada Admin" },
  ctrl: { role: "stock-controller", displayName: "Cara Controller" },
  ctrl2: { role: "stock-controller", displayName: "Colin Controller" },
  // A leftover or hand-made profile with a non-staff role must get no access at all.
  mgr: { role: "site-manager", displayName: "Thabo Manager" },
  gone: { role: "stock-controller", displayName: "Former Staff", active: false },
};

/** Seed users, balances, settings and conversions with rules disabled (as the owner would via setup). */
export async function seed(env, { onHand = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await env.clearFirestore();
      break;
    } catch (e) {
      if (attempt >= 4) throw e; // emulator can briefly return 500 while a previous test's writes settle
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, p] of Object.entries(PEOPLE)) {
      await setDoc(doc(db, "users", uid), { active: true, email: "", ...p, updatedAt: serverTimestamp(), updatedBy: "seed", lastAuditId: "seed-audit" });
    }
    await setDoc(doc(db, "inventory", "balances"), { onHand, version: 0, lastMovementId: null, updatedAt: serverTimestamp(), updatedBy: "seed" });
    await setDoc(doc(db, "settings", "app"), { company: "Stock Control", lowThreshold: 2, updatedAt: serverTimestamp(), updatedBy: "seed" });
    await setDoc(doc(db, "settings", "conversions"), {
      pairs: Object.fromEntries(D.CONVERSIONS.map((c) => [c.source, { target: c.target, ratio: c.ratio }])),
      updatedAt: serverTimestamp(),
      updatedBy: "seed",
    });
  });
}

/** Seed a ticket directly (rules disabled). */
export async function seedTicket(env, id, fields = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "tickets", id), {
      ticketId: id, seq: 1, day: "20261109", status: "ready", source: "manual-entry", manager: "Thabo Manager",
      phone: "", site: "", notes: "", rawMessage: "", items: { mop: 2 }, reviewLines: [], pasteKey: null,
      createdAt: Timestamp.now(), createdBy: "ctrl", updatedAt: Timestamp.now(), updatedBy: "ctrl",
      reviewedAt: null, reviewedBy: null, collectedAt: null, collectedBy: null, collectionMovementId: null,
      cancelledAt: null, cancelledBy: null, cancelReason: null, lastAuditId: "seed-audit-" + id,
      ...fields,
    });
  });
}

export async function readDoc(env, path) {
  let out = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(ctx.firestore(), path));
    out = snap.exists() ? snap.data() : null;
  });
  return out;
}

export async function countDocs(env, col) {
  let n = 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { getDocs, collection } = await import("firebase/firestore");
    n = (await getDocs(collection(ctx.firestore(), col))).size;
  });
  return n;
}
