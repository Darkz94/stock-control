# CLAUDE HANDOFF — Firebase backend for Stock Control
Updated: 5 November 2026

Repository: https://github.com/Darkz94/stock-control
Branch: create your own **development branch** and open a PR; do not merge or deploy without approval.

## Critical requirement: NORMAL WHATSAPP ONLY

The owner uses **regular WhatsApp Messenger**. They do **not** want WhatsApp Business, WhatsApp Business Platform/Cloud API, a BSP, webhooks for WhatsApp, paid WhatsApp sending, QR/session automation, or an unofficial WhatsApp bot. **Do not introduce any of those.**

The latest UI already supports **immediate ticket creation when a WhatsApp order is pasted** into Order tickets → Quick WhatsApp Paste, with no separate Create Ticket action. Preserve this workflow and its statuses. The app opens regular WhatsApp click-to-chat drafts; a human reviews and presses Send. Never treat opening a draft as message delivery.

## Existing application

- Static installable PWA: `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`.
- 16 product variants and individually cropped images under `assets/`. Do not change the approved design or image mapping without approval.
- Existing dashboard, stock receiving, adjustments, conversions, audit trail, export, manual tickets, instant-paste review tickets, click-to-chat message drafts and collection statuses.
- Local prototype uses `localStorage` (`stock_control_local_v1`), without login or shared data. It must not be used as a multi-device source of truth.

## Ticket lifecycle to preserve

1. Manager sends normal WhatsApp to the operator.
2. Operator copies/pastes into Quick WhatsApp Paste.
3. App **immediately saves** a unique ticket `SC-YYYYMMDD-####` in `review` / **Needs review**. Preserve raw message, parsed line items, unmatched text, optional manager/site/phone, timestamps, source `manual-whatsapp-paste`.
4. Operator can edit and confirm the same ticket; valid manager and at least one product required. Status then `new` / **New request**.
5. Controller starts preparing, then marks `ready` / **Ready to collect**.
6. Controller opens a manual WhatsApp draft addressed to the manager and taps Send personally. Never mark the notification sent automatically.
7. When collected, stock is deducted atomically and ticket becomes `collected`. No double collection, no negative inventory. Cancel active requests without stock deduction.
8. A pasted message with unknown products must still result in a ticket with raw text and `reviewLines`; the app must never silently guess missing pack sizes or quantities.

## Firebase build

Create or prepare connection instructions for a **new dedicated Firebase project**, separate from House Timer and AFK Ages. The owner will create/connect their Firebase account and approve deployments.

Suggested Firestore model, finalise names in design notes:
- `products/{productId}` — variant definition, pack size, image reference, category, active flag.
- `stockBalances/{productId}` — whole-pack on-hand quantities, version/updatedAt.
- `tickets/{ticketId}` — manager identity, site, requested line items, original WhatsApp text, unmatched lines, status, creator, timestamps, source, reviewer, collection details.
- `stockMovements/{movementId}` — immutable signed stock movements (receipts, corrections, conversions, collections), actor, reason, ticketId.
- `users/{uid}` — verified role, active flag, manager/site assignments, safe contact fields.
- `sites/{siteId}` — site info and authorised managers.
- `auditLogs/{id}` — significant role and order events with server timestamps.
- `settings/*` — safe nonsecret configuration.

Roles: admin, stock-controller, site-manager. Use Firebase Authentication, deny-by-default Firestore rules, verified user role and site assignments. Managers must not edit balances, alter historic orders, or see other managers' private data. Stock controllers can process tickets and stock; admins can manage staff. Avoid trusting client-side role flags. Provide Firestore rules tests.

Implement atomic Firestore transactions or trusted server functions for receiving, correcting, converting, and issuing stock, with idempotency and audit recording. Run all dependent mutations in one transaction. Product counts cannot go below zero; a collected order cannot be reissued. New ticket IDs and writes must be collision-resistant across multi-user devices (do not rely on the browser's local `nextTicket` counter in production). Retain the original message and timestamps for review while protecting personal information.

Make the app work with Firestore updates across multiple devices, with optimistic loading/error states, offline handling appropriate to stock risk, and no misleading success before the backend confirms. If migrating local prototype data, build an explicit admin-reviewed import flow that avoids duplicate tickets and stock movements.

## Manager self-service alternative (optional Phase 2)

Provide an authenticated **in-app ordering form**, where managers select catalogue products and submit an order. Their request creates a Firestore ticket automatically, with no WhatsApp API or copied message. Keep human-to-human normal WhatsApp for messages.

## User privacy and operational controls

- Public repository contains no real phone numbers, pasted WhatsApp messages, personal staff data, service-account keys or credentials.
- Use environment separation and document secure Firebase setup. Firebase web config is not authentication; Firestore rules are essential.
- Do not enable billing, deploy rules or Cloud Functions, provision phone numbers, contact managers or send real messages without explicit approval.
- Manual chat opening is not successful delivery; no unsupported claim of WhatsApp read receipts.
- Product conversions are inventory records, not instructions for physically repackaging chemicals.

## Required tests

- Pasting a normal multiline order creates a persisted `review` ticket instantly, with unique ID.
- `2 x Pine Gel 5L\n4 x Two-Stroke Oil 500ml\n3 x Black Bags` recognises exact products and quantities.
- Correctly distinguish **non-selective** from selective herbicide, and **500 ml** from **20 L** two-stroke oil.
- Missing manager, unknown products, text-only messages or unclear quantities remain reviewable with the original text intact.
- Accidental repeated paste does not create a duplicate immediately.
- Review/edit/confirm advances a ticket; review tickets cannot be prepared or collected.
- Stock deduction occurs only upon collection and exactly once.
- Cross-device concurrency cannot create negative balances, double issues or lost history.
- Authorised/unauthorised roles pass/fail security rules tests.
- WhatsApp buttons only open drafts; no API calls or automatic sends.

## Deliverables

1. Development branch with PR and design notes.
2. Working Firebase authentication, Firestore schema, rules, indexes and data access integration.
3. Emulator tests and app tests with how-to-run instructions.
4. Sample data and placeholder environment documentation only; no sensitive credentials.
5. Clear step-by-step owner checklist to connect Firebase and grant permissions.
6. Separate instructions for testing before deployment, requiring approval before production release.

See `docs/WHATSAPP_INTEGRATION.md` for the fixed normal-WhatsApp requirement.

References: https://firebase.google.com/docs/firestore/security/get-started and https://firebase.google.com/docs/firestore/manage-data/transactions
