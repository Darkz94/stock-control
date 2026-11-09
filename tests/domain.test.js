// Pure domain tests (parser, transitions, stock planning). No browser, no Firebase.
// Run: node --test tests/domain.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../domain.js");
const { createLocalBackend } = require("../backend-local.js");

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test("handoff example message: exact products and quantities", () => {
  const r = D.parseWhatsApp("2 x Pine Gel 5L\n4 x Two-Stroke Oil 500ml\n3 x Black Bags");
  assert.deepEqual(r.lines, [
    { productId: "pine-gel-5l", quantity: 2 },
    { productId: "two-stroke-500ml", quantity: 4 },
    { productId: "black-bags", quantity: 3 },
  ]);
  assert.deepEqual(r.unmatched, []);
});

test("non-selective vs selective herbicide are never confused", () => {
  assert.deepEqual(D.parseWhatsApp("2 x non-selective herbicide 20L").lines, [{ productId: "non-selective-20l", quantity: 2 }]);
  assert.deepEqual(D.parseWhatsApp("1 x Non selective 1 litre").lines, [{ productId: "non-selective-1l", quantity: 1 }]);
  assert.deepEqual(D.parseWhatsApp("3 x selective herbicide 20 L").lines, [{ productId: "selective-20l", quantity: 3 }]);
  assert.deepEqual(D.parseWhatsApp("2 x selective 5L").lines, [{ productId: "selective-5l", quantity: 2 }]);
  // Non-selective only exists in 1 L and 20 L: "non-selective 5L" must NOT become selective 5 L.
  const odd = D.parseWhatsApp("2 x non-selective 5L");
  assert.deepEqual(odd.lines, []);
  assert.equal(odd.unmatched.length, 1);
  const odd2 = D.parseWhatsApp("nonselective herbicide 5 l x 2");
  assert.deepEqual(odd2.lines, []);
});

test("two-stroke 500 ml vs 20 L are never confused", () => {
  assert.deepEqual(D.parseWhatsApp("4 x two stroke oil 500 ml").lines, [{ productId: "two-stroke-500ml", quantity: 4 }]);
  assert.deepEqual(D.parseWhatsApp("1 x two-stroke oil 20L").lines, [{ productId: "two-stroke-20l", quantity: 1 }]);
  assert.deepEqual(D.parseWhatsApp("2 x 2 stroke 20 litres").lines, [{ productId: "two-stroke-20l", quantity: 2 }]);
  assert.deepEqual(D.parseWhatsApp("2 x 2 stroke 500ml").lines, [{ productId: "two-stroke-500ml", quantity: 2 }]);
  const both = D.parseWhatsApp("2 x two stroke 500ml and 1 x two stroke 20L");
  assert.deepEqual(both.lines, [], "two sizes in one sentence go to review, not a guess");
  assert.equal(both.unmatched.length, 1);
});

test("missing pack size is never guessed", () => {
  for (const msg of ["2 x two stroke oil", "3 x pine gel", "1 x selective herbicide", "2 x non-selective herbicide"]) {
    const r = D.parseWhatsApp(msg);
    assert.deepEqual(r.lines, [], msg);
    assert.equal(r.unmatched.length, 1, msg);
  }
});

test("unknown products, text-only and unclear quantities stay reviewable", () => {
  assert.equal(D.parseWhatsApp("Please send the equipment").unmatched.length, 1);
  assert.deepEqual(D.parseWhatsApp("Hi, can you help me today?").lines, []);
  const unclear = D.parseWhatsApp("black bags please");
  assert.deepEqual(unclear.lines, [{ productId: "black-bags", quantity: 1 }]);
  assert.match(unclear.unmatched[0], /Quantity assumed as 1/);
  const big = D.parseWhatsApp("100000 x black bags");
  assert.deepEqual(big.lines, []);
});

test("WhatsApp export header and sender lines are handled", () => {
  const msg = "[05/11/2026, 08:14] Thabo M: 2 x Pine gel 5 L\n3 x black bags";
  assert.equal(D.capturedManager(msg), "Thabo M");
  assert.deepEqual(D.parseWhatsApp(msg).lines, [{ productId: "pine-gel-5l", quantity: 2 }, { productId: "black-bags", quantity: 3 }]);
  assert.equal(D.capturedManager("Manager: Lindiwe\n2 x mop"), "Lindiwe");
});

test("phone normalisation for click-to-chat", () => {
  assert.equal(D.whatsappPhone("082 123 4567"), "27821234567");
  assert.equal(D.whatsappPhone("+27 82 123 4567"), "27821234567");
  assert.equal(D.whatsappPhone("0027821234567"), "27821234567");
  assert.equal(D.whatsappPhone("bad-number"), null);
});

test("ticket transitions: review tickets cannot be prepared or collected", () => {
  const review = { status: "review", manager: "Thabo", lines: [{ productId: "mop", quantity: 1 }] };
  assert.equal(D.checkTransition(review, "preparing").ok, false);
  assert.equal(D.checkTransition(review, "ready").ok, false);
  assert.equal(D.checkTransition(review, "collected").ok, false);
  assert.equal(D.checkTransition(review, "cancelled").ok, true);
  const noManager = { status: "new", manager: D.MANAGER_PLACEHOLDER, lines: [{ productId: "mop", quantity: 1 }] };
  assert.equal(D.checkTransition(noManager, "preparing").ok, false);
  const ok = { status: "ready", manager: "Thabo", lines: [{ productId: "mop", quantity: 1 }] };
  assert.equal(D.checkTransition(ok, "collected").ok, true);
  assert.equal(D.checkTransition({ ...ok, status: "collected" }, "collected").ok, false);
  assert.equal(D.checkTransition({ ...ok, status: "collected" }, "cancelled").ok, false);
});

test("stock planning never goes negative", () => {
  assert.equal(D.planCollection({ mop: 1 }, [{ productId: "mop", quantity: 2 }]).ok, false);
  assert.deepEqual(D.planCollection({ mop: 2 }, [{ productId: "mop", quantity: 2 }]).out, { mop: 2 });
  assert.equal(D.planStockChange({ mop: 1 }, "mop", "out", 2).ok, false);
  assert.deepEqual(D.planStockChange({ mop: 5 }, "mop", "count", 3).removed, { mop: 2 });
  assert.equal(D.planStockChange({ mop: 3 }, "mop", "count", 3).ok, false);
  assert.deepEqual(D.planConversion({ "pine-gel-20l": 2 }, "pine-gel-20l", 1).added, { "pine-gel-5l": 4 });
  assert.equal(D.planConversion({ "pine-gel-20l": 0 }, "pine-gel-20l", 1).ok, false);
  assert.throws(() => D.applyMovement({ mop: 1 }, {}, { mop: 2 }));
});

test("ticket numbers use the South African calendar day", () => {
  assert.equal(D.sastDayKey(new Date("2026-11-08T22:30:00Z")), "20261109");
  assert.equal(D.sastDayKey(new Date("2026-11-09T21:59:00Z")), "20261109");
  assert.equal(D.formatTicketId("20261109", 7), "SC-20261109-0007");
});

test("local backend: paste creates a review ticket instantly; repeat paste does not duplicate", async () => {
  const b = createLocalBackend(memoryStorage());
  const msg = "2 x Pine Gel 5L\n4 x Two-Stroke Oil 500ml\n3 x Black Bags";
  const first = await b.capturePaste({ message: msg, manager: "", phone: "", site: "Complex A" });
  assert.equal(first.duplicate, false);
  assert.match(first.ticket.id, /^SC-\d{8}-0001$/);
  assert.equal(first.ticket.status, "review");
  assert.equal(first.ticket.rawMessage, msg);
  assert.equal(first.ticket.source, "manual-whatsapp-paste");
  const again = await b.capturePaste({ message: msg, manager: "", phone: "", site: "Complex A" });
  assert.equal(again.duplicate, true);
  assert.equal(again.ticket.id, first.ticket.id);
  assert.equal(b._data().tickets.length, 1);
  const textOnly = await b.capturePaste({ message: "Hi, please call me", manager: "", phone: "", site: "" });
  assert.equal(textOnly.ticket.status, "review");
  assert.deepEqual(textOnly.ticket.lines, []);
  assert.deepEqual(textOnly.ticket.reviewLines, ["Hi, please call me"]);
  assert.equal(textOnly.ticket.manager, D.MANAGER_PLACEHOLDER);
});

test("local backend: review/confirm, stock deducted once on collection only", async () => {
  const b = createLocalBackend(memoryStorage());
  await b.adjustStock({ productId: "pine-gel-5l", mode: "in", amount: 3, reason: "Delivery" });
  const { ticket } = await b.capturePaste({ message: "2 x pine gel 5l", manager: "", phone: "", site: "" });
  await assert.rejects(b.changeStatus(ticket.id, "preparing"), /not allowed/);
  await assert.rejects(b.reviewTicket(ticket.id, { manager: "", lines: ticket.lines }), /manager/);
  await b.reviewTicket(ticket.id, { manager: "Thabo", phone: "", site: "", notes: "", lines: ticket.lines });
  assert.equal(b._data().tickets[0].status, "new");
  await b.changeStatus(ticket.id, "preparing");
  assert.equal(b._data().counts["pine-gel-5l"], 3, "preparing does not deduct");
  await b.changeStatus(ticket.id, "ready");
  await b.changeStatus(ticket.id, "collected");
  assert.equal(b._data().counts["pine-gel-5l"], 1);
  await assert.rejects(b.changeStatus(ticket.id, "collected"));
  await assert.rejects(b.changeStatus(ticket.id, "cancelled"));
  assert.equal(b._data().counts["pine-gel-5l"], 1);
  assert.equal(b._data().movements.filter((m) => m.ticketId === ticket.id).length, 1);
});

test("local backend: cancel never touches stock; insufficient stock blocks collection", async () => {
  const b = createLocalBackend(memoryStorage());
  await b.adjustStock({ productId: "mop", mode: "in", amount: 1, reason: "Delivery" });
  const { ticket } = await b.createTicket({ manager: "Thabo", phone: "", site: "", rawMessage: "", notes: "", lines: [{ productId: "mop", quantity: 2 }] });
  await b.changeStatus(ticket.id, "ready");
  await assert.rejects(b.changeStatus(ticket.id, "collected"), /Not enough stock/);
  assert.equal(b._data().tickets[0].status, "ready");
  await b.changeStatus(ticket.id, "cancelled");
  assert.equal(b._data().counts.mop, 1);
});

test("firestore.rules product list matches the app catalogue", () => {
  const rules = require("fs").readFileSync(require("path").join(__dirname, "../firestore.rules"), "utf8");
  const m = rules.match(/function productIds\(\) \{\s*return \[([^\]]*)\]/);
  assert.ok(m, "productIds() not found in rules");
  const ids = m[1].split(",").map((x) => x.trim().replace(/'/g, ""));
  assert.deepEqual(ids, D.PRODUCTS.map((p) => p.id));
});
