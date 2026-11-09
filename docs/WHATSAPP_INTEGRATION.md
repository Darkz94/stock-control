# Normal WhatsApp Messenger workflow — no Business API

This project uses **ordinary WhatsApp Messenger**, not WhatsApp Business or the WhatsApp Business Platform.

## What is possible

- A manager messages the stock controller using their usual WhatsApp.
- The stock controller copies the manager's message and pastes it into **Order tickets → Quick WhatsApp Paste**.
- Pasting triggers an **immediately saved, numbered ticket** in **Needs review**. The original message is preserved; matched catalogue products and any unmatched lines are shown.
- The controller opens **Review and confirm ticket** to check the manager, site, items, pack sizes and quantities. They can add or correct lines.
- The ticket then progresses **New request → Preparing → Ready to collect → Collected**, with collection debiting actual stock once.
- The controller taps **Open WhatsApp: ready notice** to open a prefilled message in their usual WhatsApp chat. **They must review and tap Send**.
- An optional button can open a prefilled copy for the controller's own regular WhatsApp number. A copy-text button is available if opening a chat fails.
- Missing/unrecognised products or a missing manager must be reviewed; nothing is issued automatically. Duplicate identical pastes within 60 seconds reopen the existing ticket.

## What is *not* supported

Regular WhatsApp does **not** expose a supported public interface for third-party apps to read chats, listen for incoming messages, send messages or confirm delivery automatically. Do **not** claim automatic inbound capture or outbound replies. Do **not** build unofficial WhatsApp Web session bots, browser automation, QR-session scrapers or integrations designed to circumvent platform rules. Do not ask managers for WhatsApp account credentials.

The `https://wa.me/<international-number>?text=<encoded-message>` URL opens the WhatsApp conversation with a prewritten message. The app cannot know whether the operator tapped Send.

## Site managers do not use the app

By the owner's decision, site managers do **not** get app accounts. They send stock requests only through normal WhatsApp, and the stock controller pastes each one into the app. Only admins and stock controllers can sign in (enforced by the Firestore security rules).

## Security and safety

- The local prototype mode is localStorage-only and not an authenticated multi-user system. Firebase mode adds sign-in, role-based Firestore rules and transactional stock changes (see FIREBASE_DESIGN.md).
- The repository is public. Do not commit real manager phone numbers, personal conversations, stock details, Firebase private credentials, or API secrets.
- Do not use a WhatsApp draft as proof of sending; collection status and messaging are separate.
- Product images are illustrations, not chemical safety labels. All physical chemical work follows product labels, safety data sheets and workplace policy.
