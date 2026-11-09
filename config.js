/* Stock Control — backend selection.
 *
 * backend: "local"    → single-device prototype (localStorage, no login). Default.
 *          "firebase" → shared Firebase Authentication + Cloud Firestore backend.
 *
 * firebase: null      → on Firebase Hosting the app reads your project's web config automatically
 *                       from /__/firebase/init.json, so nothing project-specific is committed here.
 *           {…}       → or paste the web app config object from the Firebase console. The web config
 *                       is NOT a password: access is controlled by sign-in and firestore.rules.
 *                       Never put service-account keys, admin credentials or phone numbers in this repo.
 *
 * offlineCache: true  → keep a copy of the last synced data on the device for offline viewing
 *                       (cleared on sign-out). Set false for shared/public computers.
 */
window.STOCK_CONTROL_CONFIG = {
  backend: "local",
  firebase: null,
  useEmulators: false,
  offlineCache: true,
};

// Developer convenience: http://localhost:5000/?emulator=1 talks to the local Firebase emulators
// (see docs/FIREBASE_TESTING.md). Ignored on any other host.
(function () {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("emulator") === "1" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      Object.assign(window.STOCK_CONTROL_CONFIG, { backend: "firebase", useEmulators: true });
    }
  } catch (_) {
    /* non-browser environment */
  }
})();
