// Node-only deterministic app tests; works without a browser or Firebase account.
// Loads the real browser scripts (domain.js, backend-local.js, app.js) into a fake DOM context.
const fs = require("fs"),
  vm = require("vm"),
  path = require("path"),
  assert = require("node:assert/strict");
const elements = new Map();
function el(key) {
  if (!elements.has(key))
    elements.set(key, { innerHTML: "", textContent: "", value: "", dataset: {}, classList: { remove() {}, add() {}, toggle() {} }, addEventListener() {}, querySelectorAll() { return []; }, contains() { return false; } });
  return elements.get(key);
}
const saved = {};
const ctx = {
  console, Date, Math, Number, Object, Array, Map, Set, String, JSON, RegExp, Intl, Promise, Error, TextEncoder,
  crypto: require("crypto").webcrypto,
  document: { querySelector: el, querySelectorAll() { return []; }, addEventListener() {}, getElementById: el },
  navigator: {},
  location: { protocol: "file:", search: "", hostname: "" },
  scrollTo() {}, open() {}, addEventListener() {}, dispatchEvent() {},
  localStorage: { getItem: (key) => saved[key] || null, setItem: (key, value) => (saved[key] = value) },
  setTimeout, clearTimeout,
};
ctx.window = ctx; // browser scripts use window.* and globalThis interchangeably
vm.createContext(ctx);
for (const f of ["config.js", "domain.js", "backend-local.js", "app.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f });
const evalCode = (code) => vm.runInContext(code, ctx);

(async () => {
  await new Promise((r) => setTimeout(r, 20)); // let app.js boot the local backend
  assert.equal(evalCode("STOCK_CONTROL_CONFIG.backend"), "local", "committed config must default to the local prototype");
  assert.equal(evalCode("PRODUCTS.length"), 16);
  assert.equal(evalCode("CONVERSIONS.length"), 4);
  assert.deepEqual(JSON.parse(JSON.stringify(evalCode(`parseWhatsApp('2 x Pine gel 5 L\\n1 x Two-stroke oil 500 ml\\n3 x Black bags').lines`))), [
    { productId: "pine-gel-5l", quantity: 2 },
    { productId: "two-stroke-500ml", quantity: 1 },
    { productId: "black-bags", quantity: 3 },
  ]);
  assert.equal(evalCode("parseWhatsApp('Please send the equipment').unmatched.length"), 1);
  assert.equal(evalCode("whatsappPhone('082 123 4567')"), "27821234567");
  assert.equal(evalCode("whatsappPhone('bad-number')"), null);
  assert.equal(evalCode("backend.mode"), "local");

  // Stock deductions happen once only on Collected, and never go below zero.
  await evalCode(`(async () => {
    await backend.adjustStock({ productId: 'pine-gel-5l', mode: 'in', amount: 3, reason: 'test' });
    const r = await backend.createTicket({ manager: 'Test', phone: '', site: '', rawMessage: '', notes: '', lines: [{ productId: 'pine-gel-5l', quantity: 2 }] });
    globalThis.T1 = r.ticket.id;
    await backend.changeStatus(T1, 'ready');
  })()`);
  await evalCode("changeStatus(T1, 'collected')");
  assert.equal(evalCode("data.counts['pine-gel-5l']"), 1);
  assert.equal(evalCode("data.movements.filter(x => x.ticketId === T1).length"), 1);
  await evalCode("changeStatus(T1, 'collected')");
  assert.equal(evalCode("data.counts['pine-gel-5l']"), 1);
  // Insufficient inventory blocks collection without changing the ticket.
  await evalCode(`(async () => {
    const r = await backend.createTicket({ manager: 'Test', phone: '', site: '', rawMessage: '', notes: '', lines: [{ productId: 'pine-gel-5l', quantity: 5 }] });
    globalThis.T2 = r.ticket.id;
    await backend.changeStatus(T2, 'ready');
  })()`);
  await evalCode("changeStatus(T2, 'collected')");
  assert.equal(evalCode("data.counts['pine-gel-5l']"), 1);
  assert.equal(evalCode("data.tickets.find(t => t.id === T2).status"), "ready");
  // Data persisted in the same localStorage format as the original prototype.
  const stored = JSON.parse(saved.stock_control_local_v1);
  assert.equal(stored.schema, 1);
  assert.equal(stored.counts["pine-gel-5l"], 1);
  for (const p of JSON.parse(JSON.stringify(evalCode("PRODUCTS")))) assert.ok(fs.existsSync(path.join(__dirname, "../assets", p.img)), `Missing image: ${p.img}`);
  console.log("PASS: catalogue and images, message parser, WhatsApp numbers, single-issue collection and insufficient-stock protection (local backend)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
