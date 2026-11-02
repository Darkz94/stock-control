# Claude implementation handoff — Stock Control

**Repository:** `Darkz94/stock-control` (currently a static, local-first prototype)

You are implementing a secure cloud backend and WhatsApp workflow for an existing mobile-friendly stock-control web app. Read and preserve the existing UI, product catalogue, image filenames and functional local prototype. Work on a feature branch and submit a PR; do **not** deploy to production, change account billing, send real messages, or expose real personal/business numbers without the owner's explicit approval.

## Overview

The stock controller receives WhatsApp requests from authorised property/site managers. The system opens tickets, maintains stock balances and a movement audit, and sends a WhatsApp notification when each ticket is ready for collection. Stock is issued only when marked Collected. Managers may eventually be able to log in and order directly. The application is currently plain HTML/CSS/JS (`index.html`, `app.js`, `styles.css`) with 16 cropped pictures in `assets/`, an installable PWA shell, a working localStorage prototype, WhatsApp click-to-chat drafts and exports.

### Product catalogue (stable IDs)

- `two-stroke-500ml`, `two-stroke-20l` — two-stroke oil 500 ml bottles / 20 L buckets
- `nylon-line` — nylon/trimmer line spool (confirm spool specification)
- `pine-gel-5l`, `pine-gel-20l` — pine gel buckets
- `non-selective-20l`, `non-selective-1l` — non-selective herbicide 20 L plastic container / 1 L bottle
- `selective-20l`, `selective-5l` — selective herbicide 20 L container / 5 L bucket
- `bleach-5l` — bleach (5 L is an image/prototype assumption; confirm)
- `toilet-paper`, `black-bags`, `rake`, `broom`, `mop`, `broom-sticks` — cleaning supplies and tools

Keep product IDs and related image file names intact. All opening balances zero; do not invent or seed actual stock quantities, manager names, numbers, sites or orders.

## Phase 1: Firebase scaffolding (prepare, no production deployment)

1. Create a **separate** Firebase project for Stock Control (not the existing House Timer Firebase project). Owner will connect Firebase account, choose unique project ID and approve any billing upgrade. Keep sensitive info out of GitHub and do not commit service-account private keys, Meta access tokens, phone numbers or secrets.
2. Install the Firebase SDK and tooling; prefer a minimal modern build structure if needed, but retain UI appearance, mobile responsiveness, static assets, PWA support and the ability to run locally.
3. Firebase Authentication: allowlisted staff accounts, email/password or appropriate approved provider. Roles `admin` / `stock_controller` / `manager` mapped to immutable Auth custom claims set only by trusted administrators, not self-assigned client fields. Disable public self-service access to inventory. Site-scoped manager access to own tickets only; stock controller/admin access to inventory and operational tickets. Have a secure and auditable bootstrap process for the first admin.
4. Firestore collections: `products`, `inventory`, `tickets`, `movements`, `staff`, `sites`, `incomingWhatsApp`, `outgoingWhatsApp`, `settings` (choose names consistently and document schema). Product images can remain static hosted assets. Each inventory document stores a whole-pack count, update timestamps and optional low stock threshold. Tickets include status, manager/site refs, line items, createdAt/updatedAt, preparedAt, readyAt, collectedAt, responsible actor, message IDs and message status. Movements are immutable once created.
5. Secure the database with `firestore.rules` using least privilege, explicit denial for unauthenticated users, role-based scoped reads, and NO direct arbitrary client writes to balances, movements, notification logs or audit history. Supply `firestore.indexes.json`, `firebase.json`, `.env.example` with placeholders only, and developer setup instructions.
6. Put inventory writes and ticket state transitions in validated callable Cloud Functions / server functions. Use Firestore transactions to atomically check quantities, prevent negatives, prevent double issue, and record stock movements with an audit actor. Server-side timestamps, idempotency, and consistent error messages are required. For a collection, check all line items and update counts, status and immutable movement records in one transaction. Conversions must subtract source units and add target units atomically. Consider explicit reservation only if implemented end to end; current prototype deducts only on collected.
7. Build safe one-time migration/import from local JSON backup, requiring an admin confirmation and preview before import. Prevent duplicate IDs or duplicate imported tickets. Do not silently overwrite live data.
8. Maintain data minimisation and appropriate retention for South African POPIA. Include backups, recovery and access logs; implement pagination and query boundaries for scale.
9. Tests: Firebase Emulator Suite tests for security rules (unauthenticated denied, non-staff denied, manager site scope, admin allowed), transactions (out of stock, duplicate collection, duplicate conversion, concurrency), auth, product data, no secret leakage and error recovery. Keep lint and build checks green.

## Phase 2: WhatsApp automation — prepare behind feature flag

1. Use official Meta WhatsApp Business Platform Cloud API (or a user-approved BSP). Owner will later supply a dedicated business number, WABA ID, phone number ID, app secret and access token **through secure secret storage**. Do not put them in frontend code or GitHub, even after making the repository private.
2. HTTPS webhook with Meta's GET challenge verification plus POST `X-Hub-Signature-256` signature verification. Restrict inbound requests to configured sender/allowlist when an appropriate management mapping is in place. Deduplicate retries by provider message ID and maintain robust delivery/error logs.
3. Incoming messages from a registered manager generate an **unconfirmed draft** ticket and notify the stock controller internally. Parse text conservatively: 20 L vs 5 L vs 1 L vs 500 ml must never be silently confused. Flag ambiguous lines for human review. Never issue stock on the strength of a raw WhatsApp message. The controller can approve the draft to create a real ticket.
4. On creation, optional acknowledgement to manager and internal stock-controller notification (subject to policy/service window). On status Ready, send manager a collection-ready message only once (idempotent), using an approved utility template when required. Outbound delivery statuses `queued/sent/delivered/read/failed` should be tracked separately from order status. Support resend and manual fallbacks. Collection then triggers atomic issuance; do not send a message claiming collection before it occurs.
5. Implement opt-in/notice, approved templates, Meta messaging policy and 24-hour service-window rules. Human handoff and graceful handling of unregistered senders required. Business phone credentials and real message sending remain disabled until owner authorises and connects.
6. In UI replace WhatsApp draft buttons with explicit status indicators and backstop manual click-to-chat links. Make it clear when delivery has genuinely succeeded and when it is merely a draft.

## User-owned steps (stop and provide instructions)

- User creates or grants access to *new* Firebase Stock Control project; confirms project ID, region, authentication provider and intended staff/manager accounts. Do not touch `house-timer-39028`.
- User decides whether to enable any paid Cloud Functions/hosting/WhatsApp services and confirms budget.
- User provides approved business sender credentials through secret manager, verification steps, confirmed phone numbers and WhatsApp template approvals (never in chat or git).
- User confirms actual bleach size, nylon spool specification, bag/toilet-paper packaging, site list, user roles and whether managers can order via app in addition to WhatsApp.
- Only after clear owner approval, deploy staging, test and then deploy production.

## Acceptance criteria

- Existing local demo still builds and renders, 16 asset files still load, no layout regression.
- Multiple authorised devices share accurate stock and ticket state.
- Manager A cannot view another manager's site or requests. Unauthorized users cannot query data.
- Staff can receive, adjust and convert stock; two people cannot over-issue simultaneously.
- One ticket's collection deducts each product exactly once and logs the actor/time, never producing negative counts.
- Real inbound WhatsApp creates a pending draft (after verification) and not an automatically approved stock issue.
- Ready status queues one outbound collection notice; retries are idempotent and delivery failure is visible.
- No credentials or real numbers in git; production deployment and real messaging require user approval.
- Provide PR, test evidence, Firebase rules, indexes, environment example and step-by-step connection checklist.

Official references: https://firebase.google.com/docs/firestore/security/get-started ; https://firebase.google.com/docs/firestore/manage-data/transactions ; https://developers.facebook.com/docs/whatsapp/cloud-api/ ; https://whatsappbusiness.com/policy/
