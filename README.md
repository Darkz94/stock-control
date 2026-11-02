# Stock Control — Operations Desk

A mobile-first, installable web-app prototype for cleaning and grounds-maintenance stock, manager requests, ticket tracking, and WhatsApp-assisted communication.

## Product catalogue

The app includes 16 independently tracked pack sizes: two-stroke oil (500 ml and 20 L), nylon line, pine gel (5 L and 20 L), non-selective herbicide (1 L and 20 L), selective herbicide (5 L and 20 L), bleach (illustrated as 5 L — confirm actual pack size), toilet paper, black bags, rake, broom, mop, and broom sticks. The 16 individual product images were cropped from the approved combined reference image and supplied under `assets/`.

## Working features

- Dashboard for pending orders, ready-for-collection orders, low stock and product counts.
- Inventory catalogue with photographs, category filters, search, and per-product counts.
- Receive stock, write off stock, or set an exact count, with a dated movement log.
- Four optional **pack-size stock conversions** (20 L → 500 ml, 20 L → 5 L, 20 L → 1 L and 20 L → 5 L). These are *inventory transactions*, not chemical handling instructions.
- Manual manager ticket creation, optional WhatsApp-message paste and best-effort line parser, duplicate line consolidation, and ticket IDs.
- Statuses: **New → Preparing → Ready to collect → Collected**, with cancellations for active tickets.
- Stock deducted **when marked Collected**, not merely when an order is prepared. Prevents deductions that would make stock negative.
- WhatsApp click-to-chat drafts for manager acknowledgement, manager collection notification and internal business-number notification. A user must review and send in WhatsApp. No auto-sending is claimed.
- Ticket printing, CSV exports, JSON backup/import, configurable business WhatsApp number, installable/offline PWA.

## Try it

No build dependencies. Run a local HTTP server in the project folder:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080` in a browser. On Android, host on HTTPS and use the browser's **Add to Home screen / Install app** feature. `index.html` may also open directly as a file in some desktop browsers, but service-worker offline caching requires HTTP(S).

### Example pasted request

```text
2 x Pine gel 5 L
1 x Two-stroke oil 500 ml
3 x Black bags
```

Review the detected products and quantities carefully; the parser is not AI and cannot interpret every message. Any unrecognised lines are flagged for manual checking.

## Important prototype limits

**This is NOT yet a shared production stock-control system.** Storage uses `localStorage` on each browser/device. One device cannot see other devices' live changes. The initial quantity for every product is zero. There is no staff authentication, access control, server database, webhook, push message, real WhatsApp integration or cloud backup. Opening WhatsApp drafts is **not** equivalent to sending a message. The production app must not publish any phone numbers, WhatsApp API credentials, private stock details or manager information in a public repository.

To upgrade to a team app, implement a secure backend (e.g. Firebase Authentication + Firestore), restrict access by verified staff/manager roles with security rules, move stock changes to atomic server transactions and implement audit trails. Connect Meta's WhatsApp Business Platform Cloud API with a verified business number, webhook signature validation, approved templates when required, and an opt-in/consent policy. See [Integration plan](docs/WHATSAPP_INTEGRATION.md).

## File layout

- `index.html` — single-page application shell
- `styles.css` — mobile-first interface
- `app.js` — stock catalogue, tickets, conversions, parser, WhatsApp drafts, exports
- `assets/*.webp` — individual product images, generated for this project
- `manifest.webmanifest`, `sw.js`, `icon.svg` — PWA installation and offline asset caching
- `docs/WHATSAPP_INTEGRATION.md` — plan for secure multi-user WhatsApp automation

## Data/stock rules

- Each unit means a **whole product pack**, not a loose litre.
- A conversion subtracts whole source containers and adds the corresponding whole target containers. It does not physically perform repackaging.
- A ticket can be prepared without stock, but cannot be collected until stock is available.
- Collected orders cannot be collected twice or cancelled afterward.
- Keep a JSON backup before clearing browser data or switching phones.

## Health, safety and scope

The product pictures are illustrative, not compliant chemical labels. Do not infer concentration, transfer approval, mixture instructions or container compatibility from the illustrations. Follow original product labels, safety data sheets, applicable regulations and workplace procedures for handling, storage, transport and repackaging chemicals. No chemical handling instructions are provided by the app.
