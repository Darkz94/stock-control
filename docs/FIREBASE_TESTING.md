# Testing before deployment

Production release needs the owner's explicit approval. Work through these stages in order. Stages 1–2 use only the local emulators: no Google account, no real project, no cost, no real data.

## 1. Automated tests

```sh
npm ci
npm test              # parser, ticket rules, local prototype backend (no Java needed)
npm run test:rules    # starts the Firestore emulator, runs security-rule + backend tests (needs Java 21)
```

`npm run test:rules` covers:

* Security rules (`tests/rules.test.mjs`): signed-out and unknown users are denied; disabled staff are denied; nobody can give themselves a role; admins cannot lock themselves out; any login without an admin or stock-controller role (e.g. a site manager) can read and write nothing; admins cannot grant other roles; stock cannot change without a matching movement, go below zero, be replayed or backdated; conversions must use the configured ratio; collection is refused if any part is missing or altered, and works only once; review tickets cannot be prepared or collected; the original message can never be edited; audit entries are append-only.
* Backend (`tests/backend.test.mjs`): uses the real `backend-firebase.mjs` with several simulated devices at once. Paste creates a persisted `review` ticket with the raw text; a repeated paste, even from another device, does not duplicate; concurrent pastes get unique sequential numbers; review → confirm → collect deducts stock exactly once; two devices collecting the same ticket at the same moment result in one issue; two tickets competing for the last stock never go negative; concurrent receipts lose no history; offline pastes are queued, not reported as tickets; the prototype import never duplicates.

GitHub Actions runs both on every push to this branch (`.github/workflows/tests.yml`).

The browser smoke test for the local prototype is `python3 tests/smoke.py` (needs Playwright + Chromium).

## 2. Click through the app on the emulators

```sh
npx firebase emulators:start --project demo-stock-control
# Emulator UI: http://localhost:4000  ·  app: http://localhost:5000/?emulator=1
```

1. In the Emulator UI → **Authentication → Add user** (e.g. `admin@example.test` / `password1`). Copy the UID.
2. Emulator UI → **Firestore → Start collection** `users` → document = UID → fields as in [FIREBASE_SETUP.md](FIREBASE_SETUP.md) step E (`role` = `admin`).
3. Open `http://localhost:5000/?emulator=1`, sign in, then go to **Settings & team → Run first-time setup**.
4. Add a stock controller the same way (Auth user, then **Staff & roles** in the app).
5. Check by hand, ideally in two browser windows signed in as different people:
   - [ ] Paste `2 x Pine Gel 5L` / `4 x Two-Stroke Oil 500ml` / `3 x Black Bags` → a ticket appears in **Needs review** immediately, and in the other window too.
   - [ ] Paste the same text again → the existing ticket opens; no second ticket.
   - [ ] A message with unknown items still becomes a review ticket showing the original text.
   - [ ] A review ticket has no Prepare / Ready / Collect buttons until it is confirmed with a manager name.
   - [ ] Receive stock, then collect a ticket → stock goes down once; history shows *Order collected*.
   - [ ] Try to collect the same ticket from the second window → it is refused.
   - [ ] WhatsApp buttons only open a `wa.me` draft. Nothing is sent, and the ticket is not marked "sent".
   - [ ] A login with no staff profile sees only "Waiting for access" and no data.
   - [ ] Turn the network off (DevTools → Network → Offline) → banner says offline; stock buttons are disabled; a paste shows under **Waiting to sync**. Turn it back on and it becomes a ticket.

## 3. Staging project (real Firebase, test data only)

After the owner has created `stock-control-staging` ([FIREBASE_SETUP.md](FIREBASE_SETUP.md) A–G):

```sh
npx firebase deploy --only firestore:rules,firestore:indexes,hosting --project stock-control-staging
```

Repeat the stage 2 checklist on the staging URL with phones on mobile data. Use **made-up** managers and numbers only.

## 4. Production release — approval required

Only after the owner says "approved":

```sh
npx firebase deploy --only firestore:rules,firestore:indexes --project stock-control-prod
npx firebase deploy --only hosting --project stock-control-prod
```

Then do first-time setup, create real staff, and optionally import the prototype backup (FIREBASE_SETUP.md F–G).

Roll back hosting from **Firebase console → Hosting → Release history → Roll back**. Rules have history under **Firestore → Rules**.
