/* Stock Control — loads the Firebase SDK (only when config.js selects the Firebase backend) and
 * creates the backend. Nothing is downloaded in local prototype mode. */
const SDK_VERSION = "13.1.0"; // keep in step with package.json devDependency "firebase"
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;

async function start(cfg = {}) {
  const [appMod, authMod, fsMod, backendMod] = await Promise.all([
    import(CDN + "firebase-app.js"),
    import(CDN + "firebase-auth.js"),
    import(CDN + "firebase-firestore.js"),
    import("./backend-firebase.mjs"),
  ]);
  const emulator = !!cfg.useEmulators;
  let firebaseConfig = cfg.firebase;
  if (emulator) firebaseConfig = { apiKey: "demo-key", authDomain: "localhost", projectId: cfg.emulatorProjectId || "demo-stock-control" };
  else if (!firebaseConfig) {
    const res = await fetch("/__/firebase/init.json");
    if (!res.ok) throw new Error("No Firebase config. Set `firebase` in config.js, or host on Firebase Hosting.");
    firebaseConfig = await res.json();
  }
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const useCache = cfg.offlineCache !== false && !emulator;
  const db = useCache
    ? fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }) })
    : fsMod.initializeFirestore(app, {});
  if (emulator) {
    const host = location.hostname;
    authMod.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    fsMod.connectFirestoreEmulator(db, host, 8085);
  }
  const pick = (mod, names) => Object.fromEntries(names.map((n) => [n, mod[n]]));
  const sdk = {
    ...pick(fsMod, ["doc", "collection", "query", "where", "orderBy", "limit", "onSnapshot", "runTransaction", "serverTimestamp"]),
    ...pick(authMod, ["onAuthStateChanged", "signInWithEmailAndPassword", "signOut", "sendPasswordResetEmail"]),
  };
  const backend = backendMod.createFirebaseBackend({
    sdk, domain: window.StockDomain, auth, db, storage: window.localStorage, isOnline: () => navigator.onLine !== false,
  });
  // On sign-out, also wipe this device's offline copy of shared data, then start fresh.
  const baseSignOut = backend.signOut;
  backend.signOut = async () => {
    await baseSignOut();
    try {
      await fsMod.terminate(db);
      if (useCache) await fsMod.clearIndexedDbPersistence(db);
    } catch (e) {
      console.warn("Could not clear offline cache", e);
    }
    location.reload();
  };
  return backend;
}

window.StockFirebase = { start, SDK_VERSION };
window.dispatchEvent(new Event("stock-firebase-loaded"));
