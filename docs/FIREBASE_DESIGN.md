# Firebase backend — design notes

Status: development branch `firebase-backend`. Nothing has been deployed. The committed `config.js` still selects the **local prototype**, so the live app behaves exactly as before until the owner switches it over.

## 1. What changed and what did not

| Kept exactly | Added |
|---|---|
| Approved design, 16 products, image mapping | Firebase Authentication (email + password) |
| Quick WhatsApp Paste → instant `review` ticket, no Create button | Shared Cloud Firestore data across devices |
| Statuses Needs review → New → Preparing → Ready → Collected / Cancelled | Server-enforced roles: admin, stock controller, site manager |
| Stock deducted only on collection, once, never negative | Security rules that check every stock change |
| Normal WhatsApp click-to-chat drafts; a person taps Send | Append-only audit log of ticket and staff changes |
| Local prototype mode (still the default) | Offline queue for pastes; read-only offline viewing |
| | Admin-reviewed import from a prototype JSON backup |
| | Phase 2: site-manager in-app order form |

There is no WhatsApp Business, Cloud API, BSP, webhook, bot, QR session or automatic sending anywhere. Opening a draft is never recorded as delivery.

## 2. Architecture

```
index.html
 ├─ config.js            backend: "local" | "firebase"  (default "local")
 ├─ domain.js            shared rules: catalogue, parser, transitions, stock planning (pure functions)
 ├─ backend-local.js     localStorage backend (prototype)          ┐ same async interface
 ├─ backend-firebase.mjs Firestore/Auth backend (transactions)     ┘
 ├─ firebase-loader.mjs  loads Firebase SDK 13.1.0 from gstatic only in Firebase mode
 └─ app.js               UI; talks only to the backend interface
firestore.rules          the real security boundary
```

There is still no build step. The Firebase SDK is loaded as versioned ES modules from `https://www.gstatic.com/firebasejs/13.1.0/`, and the service worker caches it after first use so the app can start offline.

`app.js` never changes data directly. Every action calls the backend and shows **Saving…** until the promise resolves. The Firebase backend resolves only after the Firestore **transaction has committed on the server**, so no success message appears before the backend confirms.

## 3. Firestore data model

| Path | Purpose | Who can read | Who can write |
|---|---|---|---|
| `users/{uid}` | `role`, `active`, `displayName`, `email`, `phone`, `sites[]` | self; staff | admin only (with audit entry). Admins cannot demote themselves |
| `inventory/balances` | `onHand {productId: packs}`, `version`, `lastMovementId` | staff | staff, **only together with a new movement** that explains the change |
| `stockMovements/{id}` | immutable `kind`, `added{}`, `removed{}`, `reason`, `ticketId`, `actorUid`, `at` | staff | staff (create only) |
| `tickets/{SC-YYYYMMDD-####}` | manager, site, phone, `items{}`, `rawMessage`, `reviewLines[]`, status + who/when stamps | staff; the linked manager | staff (lifecycle); managers create in-app orders |
| `counters/tickets-YYYYMMDD` | daily ticket sequence | signed-in users | only while creating the matching ticket |
| `pasteLocks/{sha256}` | cross-device duplicate-paste guard | staff | only while creating a ticket |
| `auditLogs/{id}` | append-only events with server time | staff | must be created in the same write as the ticket/user change it describes |
| `products/{id}` | catalogue reference copy (seeded by setup) | signed-in users | admin |
| `settings/app`, `settings/conversions` | company name, low-stock level; pack ratios | signed-in users | admin |

### Changes from the suggested model

* **One `inventory/balances` document instead of `stockBalances/{productId}`.** Security rules cannot loop and have a limited number of document reads per request. With one document, a single rule can check that *every* product changed in a collection equals `old − removed + added` and stays ≥ 0, however many lines the ticket has. Throughput limit: about one stock change per second sustained, which is far above what one stock desk needs. If volumes ever grow, move stock writes to Cloud Functions (needs the Blaze plan).
* **`items` is a `{productId: quantity}` map instead of a list.** Rules can compare maps directly, so "the stock removed equals the ticket's items" is one check.
* **Sites are a list on the manager's user profile** (`sites: ["Complex A"]`), not a separate collection. Tickets keep the site name as text. That is enough for assigning managers and for the in-app order form, and avoids another collection to secure. A `sites` collection can be added later without migration.

## 4. How integrity is enforced (server side)

Firestore rules (`firestore.rules`) are the boundary. The app's own checks only give friendlier messages earlier.

1. **Roles** come only from `users/{uid}`, which only admins can write. The first admin is created by the owner in the Firebase console. A login without a profile, or with `active: false`, can read nothing.
2. **Balances follow movements.** A balance update must name a `lastMovementId` that did not exist before the request and does after it. Each changed product must equal `old − removed + added` and be ≥ 0. Movements cannot be edited, deleted or replayed.
3. **Collection happens exactly once.** `ready → collected` must come with the movement `stockMovements/{ticketId}_collect`, whose `removed` map equals the ticket's `items` exactly. That id is fixed and movements are create-only, so a second collection from any device is impossible. `review`, `new` and `preparing` tickets cannot be collected.
4. **The lifecycle table** (`review → new` only by confirming with a named manager and at least one product; `new → preparing/ready`; `preparing → ready`; `ready → collected`; any active → cancelled) is enforced in rules. Collected and cancelled tickets are frozen. Tickets cannot be deleted.
5. **The original pasted message, source, creation time and creator can never be edited.**
6. **Conversions** must use the ratio stored in `settings/conversions` (for example 1 × Pine gel 20 L = 4 × 5 L).
7. **Every ticket and staff change writes an audit entry in the same request**, stamped with server time and the signed-in user.
8. **Managers** can read only tickets whose `managerUid` is theirs. They can create only `in-app-order` tickets in their own name and for their own sites, and cannot read stock, movements, audit logs or other people's profiles.

Rules cannot loop, so per-product checks are unrolled for up to **20 products per ticket**. The catalogue has 16. A test fails if the product list in the rules and in `domain.js` ever differ.

## 5. Transactions, ticket numbers, duplicates

* Every change runs in `runTransaction`. All reads come first; if another device changed the same record, Firestore retries the transaction against the new data, and the domain checks run again. This is what stops two devices collecting the same ticket, or two tickets taking the last stock.
* **Ticket IDs** keep the `SC-YYYYMMDD-####` format. The day is the South African calendar day. The number comes from `counters/tickets-YYYYMMDD`, incremented inside the same transaction that creates the ticket; the rules require counter and ticket to match. The browser's local `nextTicket` counter is not used in Firebase mode.
* **Duplicate pastes**: the transaction reads `pasteLocks/{sha256(message|manager|site)}`. If the same text was captured in the last 60 seconds, **on any device**, the existing ticket is opened instead. Only a hash of the message is used as the lock id.

## 6. Offline behaviour (appropriate to stock risk)

* **Viewing**: Firestore's persistent cache shows the last synced data offline, clearly labelled *Offline — showing the last synced data*. It is cleared on sign-out. Set `offlineCache: false` in `config.js` for shared computers.
* **Stock and ticket changes are blocked offline.** Transactions need the server, so nothing can be "saved" that later fails or conflicts. If a transaction gets no confirmation within 25 seconds, the app says so instead of guessing.
* **Pasting offline**: the order is kept in a per-user *Waiting to sync* list on that device. It is clearly marked **not a ticket yet** and is submitted automatically when the connection returns (or with *Retry now*). Each queued item carries a request id, so a retry can never create a second ticket.

## 7. Privacy

* The repository contains no real names, phone numbers, messages, keys or project ids. Tests use made-up names and the `demo-stock-control` emulator project.
* The Firebase **web config is not a secret**; access is controlled by sign-in and rules. On Firebase Hosting the app reads the config from `/__/firebase/init.json`, so nothing project-specific needs committing.
* Phone numbers and pasted messages are readable only by staff, plus the linked manager for their own ticket. The controller's own WhatsApp number is stored only on their device.
* No service-account keys or Admin SDK are needed for normal operation.

## 8. Migration from the local prototype

Settings → *Review a prototype backup* (admin only):

1. Choose the JSON backup downloaded from the old version. A preview shows which tickets will be imported and how each stock count differs. **Nothing is written yet.**
2. Tickets are created as `LEGACY-<old id>`, so importing the same file twice is skipped, never duplicated. Open tickets come in as **Needs review** to be confirmed again. Collected and cancelled tickets are kept as history and do not touch stock.
3. Stock counts are applied only if ticked, as one *Imported count* movement with a deterministic id (cannot be applied twice). Old stock-history rows stay in the backup file.

## 9. Phase 2 — manager in-app orders (included)

A signed-in site manager sees *My stock requests* and a **New order** form: catalogue products, quantities, site from their profile, and notes. Submitting creates a `new` ticket immediately in the shared queue, with no WhatsApp message to copy. Managers and controllers keep talking on normal WhatsApp as usual. Staff can also link a pasted ticket to a manager's account (*Linked manager account* on review) so that manager can follow it in the app.

## 10. Known limits / follow-ups

* About one stock change per second sustained (single balances document); fine for a stock desk.
* The ticket lists load the latest 250 tickets plus every open ticket; stock history shows the latest 300 movements. Older records stay in the database and can be exported through the Firebase console.
* Rules test coverage runs on the emulator (see `FIREBASE_TESTING.md`). Production behaviour should be spot-checked on a staging project before going live.
* Firestore backups (point-in-time recovery or scheduled exports) need the Blaze plan. Decide on that with the owner; nothing has been enabled.
