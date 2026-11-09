# Owner checklist — connect your own Firebase project

Work through this in order. Nothing here costs money on the free **Spark** plan. Do **not** upgrade to Blaze, deploy, or invite staff until you have tested (see [FIREBASE_TESTING.md](FIREBASE_TESTING.md)) and approved the release.

You need: a Google account, a computer with [Node.js 20+](https://nodejs.org) and Java 21 (only for local testing), and this repository checked out on the `firebase-backend` branch.

## A. Create a dedicated project (about 10 minutes)

1. Go to <https://console.firebase.google.com> → **Add project**. Name it e.g. `stock-control-prod`. This must be a **new** project, separate from House Timer and AFK Ages. Google Analytics is not needed.
2. (Recommended) Create a second project, e.g. `stock-control-staging`, for testing with real sign-ins before production.
3. In the project: **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**. Leave "Email link" off.
4. **Build → Firestore Database → Create database** → choose **Production mode** (deny by default) → location **`africa-south1` (Johannesburg)**. The location cannot be changed later.
5. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app called `Stock Control`. Tick **Also set up Firebase Hosting** if you will host on Firebase. You do **not** need to copy the config snippet if you use Firebase Hosting.

## B. Install the tools and link this folder

```sh
npm ci                          # installs firebase-tools and the test libraries (dev only)
npx firebase login              # opens a browser; sign in with the Google account that owns the project
cp .firebaserc.example .firebaserc
# edit .firebaserc and put your real project id (e.g. stock-control-prod). .firebaserc is git-ignored.
```

## C. Test locally first

Follow [FIREBASE_TESTING.md](FIREBASE_TESTING.md) section 1–2 (emulators, no real project touched). Continue only when all tests pass.

## D. Deploy the security rules and indexes (needs your approval)

```sh
npx firebase deploy --only firestore:rules,firestore:indexes --project stock-control-staging
```

Rules decide who can see and change data. Indexes let the app list tickets. Deploy to **staging first**. Production comes later, in section G.

## E. Create the first admin (Firebase console)

1. **Authentication → Users → Add user** → your email + a strong password. Copy the **User UID** shown in the list.
2. **Firestore Database → Start collection** → collection id `users` → document id = **the UID you copied** → add fields:

   | Field | Type | Value |
   |---|---|---|
   | `role` | string | `admin` |
   | `active` | boolean | `true` |
   | `displayName` | string | your name |
   | `email` | string | your email |
   | `phone` | string | *(leave empty)* |
   | `sites` | array | *(empty)* |
   | `updatedAt` | timestamp | now |
   | `updatedBy` | string | `console` |
   | `lastAuditId` | string | `bootstrap` |

   The console bypasses the security rules. This is the **only** time data is entered by hand; everything afterwards goes through the app.

## F. Switch the app to Firebase and run first-time setup

1. In `config.js` set `backend: "firebase"`. Leave `firebase: null` if hosting on Firebase Hosting. Otherwise paste the web config object from step A5. It is not a password, but leaving it out keeps the public repo project-neutral.
2. Deploy hosting to staging: `npx firebase deploy --only hosting --project stock-control-staging`, then open the `https://<project>.web.app` link.
3. Sign in as the admin → **Settings & team → Run first-time setup**. This creates the stock record (all zero), the shared settings, the pack conversions and the product list. It never overwrites existing data.
4. Optional: **Review a prototype backup** to bring across tickets and stock counts from the old single-device version. You see a preview before anything is written.

## G. Add staff and managers

For each person:

1. **Authentication → Users → Add user** (their email + a temporary password) → copy their **UID**.
2. In the app: **Settings & team → Staff & roles → Add person** → paste the UID, enter the name, and choose a role:
   * **Stock controller**: pastes WhatsApp orders, processes tickets, receives and adjusts stock.
   * **Site manager**: sees only their own tickets and can place in-app orders for their assigned sites. They cannot see or change stock.
   * **Admin**: everything, plus staff and settings.
3. Tell them to sign in and use **Forgot password** to set their own password.

To remove someone: set **Access → Disabled** in the app (they lose access immediately), then optionally disable the login in the Firebase console.

## H. Go live (only after approval)

1. Repeat D–G on the **production** project.
2. Recommended before real data: **App Check** (reCAPTCHA Enterprise) to block scripted abuse; usage alerts in Google Cloud Billing if you ever move to Blaze.
3. Phones: open the site in Chrome → **⋮ → Add to Home screen / Install app**.

## Things to decide (not enabled)

* **Backups**: Firestore scheduled backups and point-in-time recovery need the **Blaze** (pay-as-you-go) plan. Until then, use the CSV/JSON exports in Settings regularly.
* **Cloud Functions**: not used, because they also need Blaze. The security rules already enforce the stock rules without them.

## Never commit

`.firebaserc` with real ids (it is git-ignored), service-account JSON keys, passwords, real phone numbers or pasted WhatsApp messages. The repository is public.
