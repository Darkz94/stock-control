# Stock Control — Operations Desk

A mobile-first, installable web-app prototype for cleaning and grounds-maintenance stock, manager requests, ticket tracking, and WhatsApp-assisted communication.

## Product catalogue

The app includes 16 independently tracked pack sizes: two-stroke oil (500 ml and 20 L), nylon line, pine gel (5 L and 20 L), non-selective herbicide (1 L and 20 L), selective herbicide (5 L and 20 L), bleach (illustrated as 5 L — confirm actual pack size), toilet paper, black bags, rake, broom, mop, and broom sticks. The 16 individual product images were cropped from the approved combined reference image and supplied under `assets/`.

## Working features

- Dashboard for pending orders, ready-for-collection orders, low stock and product counts.
- Inventory catalogue with photographs, category filters, search, and per-product counts.
- Receive stock, write off stock, or set an exact count, with a dated movement log.
- Four optional **pack-size stock conversions** (20 L → 500 ml, 20 L → 5 L, 20 L → 1 L and 20 L → 5 L). These are *inventory transactions*, not chemical handling instructions.
- **Instant WhatsApp paste:** pasting a manager’s message on the Order Tickets screen immediately creates a numbered ticket, without pressing Create Ticket. The saved ticket enters **Needs review** and retains the original message, parsed products, and any unmatched text. Manager, products and quantities can be corrected and confirmed on the same ticket.
- Manual manager ticket creation, best-effort line parser, duplicate line consolidation, and ticket IDs. A recent identical pasted message is deduplicated.
- Statuses: **New → Preparing → Ready to collect → Collected**, with cancellations for active tickets.
- Stock deducted **when marked Collected**, not merely when an order is prepared. Prevents deductions that would make stock negative.
- **Normal WhatsApp Messenger** click-to-chat drafts for manager acknowledgement, ready-to-collect notification, and an optional personal WhatsApp ticket copy. A person checks the recipient and manually taps Send. No WhatsApp Business Platform or WhatsApp Business app is needed.
- Ticket printing, CSV exports, JSON backup/import, optional personal WhatsApp number, installable/offline PWA.

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

## Backends: local prototype or shared Firebase

`config.js` selects the backend. The committed default is **`backend: "local"`**, the original single-device prototype: data stays in one browser's `localStorage`, there is no login, and one device cannot see another's changes. The initial quantity for every product is zero. Keep a JSON backup.

**`backend: "firebase"`** (branch `firebase-backend`) turns it into a shared team app:

- Email/password sign-in with server-verified roles: **admin**, **stock controller**, **site manager**.
- Tickets, stock and history are shared live across every signed-in device, with Firestore transactions for each change. The app only shows a change as saved once the server confirms it.
- `firestore.rules` enforce the stock rules on the server: no negative stock, every balance change is backed by an immutable movement, a ticket is issued exactly once, review tickets cannot be collected, the original WhatsApp text cannot be altered, and every ticket and staff change is audited.
- Pasting offline keeps the order on the device in a clearly marked *Waiting to sync* list until the connection returns. Stock changes are blocked offline.
- Site managers can place orders in the app (Phase 2). Normal WhatsApp stays human-to-human.
- An admin can import a prototype JSON backup, with a preview first and no duplicates on re-import.

Read in this order: [Design notes](docs/FIREBASE_DESIGN.md) → [Owner setup checklist](docs/FIREBASE_SETUP.md) → [Testing before deployment](docs/FIREBASE_TESTING.md). Nothing is deployed, billed or sent without the owner's approval.

Opening a WhatsApp draft is **not** equivalent to sending a message. Never commit real phone numbers, pasted messages, service-account keys or project secrets; the repository is public.

## Tests

```sh
npm ci
npm test               # parser, ticket rules, local backend (Node only)
npm run test:rules     # Firestore emulator: security rules + multi-device backend tests (needs Java 21)
python3 tests/smoke.py # browser smoke test of the local prototype (Playwright)
```

GitHub Actions runs all of these, plus a Firebase-mode browser test against the emulators, on every push.

## File layout

- `index.html`, `styles.css`, `app.js` — single-page application and UI
- `config.js` — choose `local` or `firebase` backend
- `domain.js` — catalogue, WhatsApp parser, ticket transitions and stock rules shared by both backends
- `backend-local.js` — localStorage prototype backend
- `backend-firebase.mjs`, `firebase-loader.mjs` — Firebase Auth + Firestore backend (SDK loaded only in Firebase mode)
- `firestore.rules`, `firestore.indexes.json`, `firebase.json` — Firebase security rules, indexes and emulator/hosting config
- `assets/*.webp` — individual product images, generated for this project
- `manifest.webmanifest`, `sw.js`, `icon.svg` — PWA installation and offline asset caching
- `tests/` — Node, emulator and browser tests
- `docs/` — WhatsApp workflow, Firebase design, setup and testing guides

## Data/stock rules

- Each unit means a **whole product pack**, not a loose litre.
- A conversion subtracts whole source containers and adds the corresponding whole target containers. It does not physically perform repackaging.
- A ticket can be prepared without stock, but cannot be collected until stock is available. **Instant-paste tickets must first be reviewed and confirmed**, and cannot be collected while in Needs Review.
- Collected orders cannot be collected twice or cancelled afterward.
- Keep a JSON backup before clearing browser data or switching phones.

## Health, safety and scope

The product pictures are illustrative, not compliant chemical labels. Do not infer concentration, transfer approval, mixture instructions or container compatibility from the illustrations. Follow original product labels, safety data sheets, applicable regulations and workplace procedures for handling, storage, transport and repackaging chemicals. No chemical handling instructions are provided by the app.
