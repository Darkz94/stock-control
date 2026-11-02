# Secure WhatsApp + shared stock integration (Phase 2)

## Intended process

1. A verified manager sends a stock request to the designated business WhatsApp number.
2. A verified webhook receives the event on a secured backend, de-duplicates it by WhatsApp message ID and stores the message privately.
3. The parser generates a **draft** request with a confidence level. A staff member confirms product mapping and pack sizes before submission.
4. The backend atomically creates the order ticket and notifies the stock controller. Acknowledgement to the manager is sent only where allowed.
5. Stock controller reviews, prepares and marks the order **Ready to collect**.
6. Backend sends a ready-for-collection WhatsApp message, using an approved utility template when the 24-hour service window has ended.
7. Actual collection triggers an atomic stock deduction and an audit entry. Inventory is never deducted twice.

## Required setup

- Registered Meta business / approved WhatsApp Business Platform sender (either Meta Cloud API or an approved solution provider).
- Business phone number, phone number ID, WhatsApp business account ID and suitable approval.
- Secure server environment and webhook HTTPS endpoint; secrets in environment/secret manager **only**.
- Approved utility templates for acknowledgements and collection notices when the service window requires them.
- Staff access via Firebase Authentication (or equivalent), manager allowlist, consent/notice for using manager numbers and messages, secure retention, backups and restricted access.
- Firestore (or equivalent database) with security rules and transactions. Do not trust the client for stock availability or deductions.

## Suggested data model

- `products/{id}`: stable ID, display name, size, unit, group, image reference, active flag, low-stock threshold.
- `inventory/{id}`: available, reserved (optional), updatedAt, version.
- `tickets/{ticketId}`: manager UID / phone (restricted), site, lines, status, timestamps, openedBy, preparedBy, collectedBy, deduplicated inbound message ID.
- `movements/{id}`: product, signed quantity, action, ticket, actor, date, reason; append-only audit stream.
- `managers/{uid}`: allowed phone number, role, site assignment, active.
- `waMessages/{messageId}`: inbound/outbound message status, source reference, retry, timestamps; restricted storage.

## Backend controls

- Verify `X-Hub-Signature-256` HMAC signature on incoming POST webhooks with the app secret; verify webhook challenge on setup.
- Idempotency for inbound webhooks and outbound sends; retry transient failures safely.
- No WhatsApp access token, App Secret, phone numbers or private stock data in static JavaScript or public GitHub.
- Validate products, sizes, quantities and allowed transitions in backend functions.
- Deduct stock on collection in an atomic transaction: confirm all available quantities, update all counts, create movements, change ticket status once.
- Staff-only authorization for issuing stock, creating inventory adjustments, changing system settings.
- Manager messages are not proof of manager identity without verified allowlist / appropriate process.
- Enforce conversation window and business-initiated template/opt-in rules; human escalation available.

## WhatsApp messaging notes

For now this prototype uses `https://wa.me/<international-number>?text=<encoded-message>` to open a draft. The app does not use a chatbot, webhook or API. Manual sending does **not** count as an automated successful delivery, so ticket status does not imply that WhatsApp notification was sent.

Relevant official references:
- WhatsApp Business Messaging Policy: https://whatsappbusiness.com/policy/
- WhatsApp Click to Chat: https://faq.whatsapp.com/5913398998672934/

## Staging guidance

Develop a new secured backend and staging number privately before switching live manager numbers. Do not use the public static demonstration for real business data. Get the business number, exact product pack sizes (bleach size, nylon spool specification, toilet-paper pack size, black-bag roll size), store locations, manager permissions and collection sign-off requirements confirmed during setup.
