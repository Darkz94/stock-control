# Stock Control — Operations Desk

A mobile-first, installable web app for cleaning and grounds-maintenance stock, manager requests, ticket tracking, and WhatsApp-assisted communication.

## Product catalogue

The app includes 26 independently tracked items and pack sizes. The Cleaning supplies catalogue includes replacement broom and mop heads, plus 5 L and 20 L containers of All Purpose Cleaner, Tile Cleaner, Dish Washing Liquid, and Hand Soap. Product photos are under `assets/`.

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
- Ticket printing, CSV exports, JSON backup/import, optional personal WhatsApp number and installable PWA. Shared records require an internet connection.

## Try it

No build dependencies. Run a local HTTP server in the project folder:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080` in a browser and sign in with an approved Stock Control account. On Android, host on HTTPS and use the browser's **Add to Home screen / Install app** feature. `index.html` may also open directly as a file in some desktop browsers, but service-worker offline caching requires HTTP(S).

### Example pasted request

```text
2 x Pine gel 5 L
1 x Two-stroke oil 500 ml
3 x Black bags
```

Review the detected products and quantities carefully; the parser is not AI and cannot interpret every message. Any unrecognised lines are flagged for manual checking.

## Private shared access

Stock Control uses Supabase email/password sign-in. The approved order operator can process tickets and adjust stock. The approved stock editor can view balances and stock history, receive stock, record write-offs and enter a stocktake count. Both accounts use the same database. Stock history records the actor and server timestamp. Use **Refresh** to check changes from the other account. When a save conflicts with another device, review the latest balance before retrying.

Create and confirm the two approved users in **Authentication → Users** in the Supabase dashboard before signing in. The database checks the confirmed identity against a private allowlist. App access does not require membership in the Supabase organisation. The app has no public sign-up form. In the Supabase Auth settings, disable new public sign-ups before taking the app live.

The previous prototype's browser records are left on their original device. Export a backup from that version if you need to migrate existing records. Shared stock starts at zero unless opening balances are entered or an import is arranged. Shared mode supports exports and does not overwrite shared records through browser backup restore.

Regular WhatsApp remains the channel for staff orders and operator replies. See [Normal WhatsApp workflow](docs/WHATSAPP_INTEGRATION.md).

## File layout

- `index.html` — single-page application shell
- `styles.css` — mobile-first interface
- `app.js` — stock catalogue, tickets, conversions, parser, WhatsApp drafts, exports
- `assets/*.webp` — individual product images, generated for this project
- `manifest.webmanifest`, `sw.js`, `icon.svg` — PWA installation and offline asset caching
- `docs/WHATSAPP_INTEGRATION.md` — normal WhatsApp workflow and Firebase-backed in-app ordering alternative

## Data/stock rules

- Each unit means a **whole product pack**, not a loose litre.
- A conversion subtracts whole source containers and adds the corresponding whole target containers. It does not physically perform repackaging.
- A ticket can be prepared without stock, but cannot be collected until stock is available. **Instant-paste tickets must first be reviewed and confirmed**, and cannot be collected while in Needs Review.
- Collected orders cannot be collected twice or cancelled afterward.
- Keep a JSON backup before clearing browser data or switching phones.

## Health, safety and scope

The product pictures are illustrative, not compliant chemical labels. Do not infer concentration, transfer approval, mixture instructions or container compatibility from the illustrations. Follow original product labels, safety data sheets, applicable regulations and workplace procedures for handling, storage, transport and repackaging chemicals. No chemical handling instructions are provided by the app.
