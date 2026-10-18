// Starts the API. Everything is set with environment variables (see README.md):
//
//   PORT                 default 8080 (Cloud Run sets it)
//   STORE                memory (default) | firestore
//   DATA_FILE            with memory: a file the village is kept in between restarts
//   AUTH_MODE            dev (default with memory) | google (default with firestore)
//   FIREBASE_PROJECT_ID  the Firebase/Google Cloud project: sign-in and Firestore
//   FIRESTORE_DATABASE   default (default)
//   FIRESTORE_EMULATOR_HOST, GOOGLE_ACCESS_TOKEN   see store/firestoreStore.ts
//   CORS_ORIGINS         comma-separated origins allowed to call from a browser
//   SEED                 demo: put the made-up village in an empty store

import { devAuth, type Authenticator } from "./auth/auth.ts";
import { googleAuth } from "./auth/googleAuth.ts";
import { createApp } from "./http/app.ts";
import { DEMO_USERS, DEMO_VILLAGE_ID, seedDemo } from "./seed.ts";
import { VillageService } from "./service.ts";
import { FirestoreStore } from "./store/firestoreStore.ts";
import { fileKeeper } from "./store/fileKeeper.ts";
import { MemoryStore } from "./store/memoryStore.ts";
import type { Store } from "./store/store.ts";

const env = process.env;
const storeKind = env.STORE ?? "memory";
const projectId = env.FIREBASE_PROJECT_ID ?? "";

function fail(message: string): never {
  console.error(`Landsbyen starter ikke: ${message}`);
  process.exit(1);
}

let store: Store;
if (storeKind === "firestore") {
  if (!projectId) fail("FIREBASE_PROJECT_ID mangler.");
  store = new FirestoreStore({
    projectId,
    databaseId: env.FIRESTORE_DATABASE,
    emulatorHost: env.FIRESTORE_EMULATOR_HOST,
    accessToken: env.GOOGLE_ACCESS_TOKEN,
  });
} else if (storeKind === "memory") {
  store = new MemoryStore(env.DATA_FILE ? fileKeeper(env.DATA_FILE) : undefined);
} else {
  fail(`ukjent STORE «${storeKind}».`);
}

const authMode = env.AUTH_MODE ?? (storeKind === "firestore" ? "google" : "dev");
let auth: Authenticator;
if (authMode === "google") {
  if (!projectId) fail("FIREBASE_PROJECT_ID mangler, og trengs for innlogging med Google.");
  auth = googleAuth(projectId);
} else if (authMode === "dev") {
  // Anyone can be anyone with this: never where real people are
  if (storeKind === "firestore" && env.ALLOW_DEV_AUTH !== "ja") {
    fail("AUTH_MODE=dev sammen med Firestore krever ALLOW_DEV_AUTH=ja. Bruk det bare mot emulatoren eller en testdatabase.");
  }
  auth = devAuth(DEMO_USERS);
} else {
  fail(`ukjent AUTH_MODE «${authMode}».`);
}

if (env.SEED === "demo" || (storeKind === "memory" && env.SEED !== "nei")) {
  if (!(await store.getVillage(DEMO_VILLAGE_ID))) await seedDemo(store);
}

const app = createApp({
  service: new VillageService({ store }),
  auth,
  corsOrigins: (env.CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
  webRoot: new URL("../web/", import.meta.url),
});

const port = Number(env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`Landsbyen svarer på http://localhost:${port} (lagring: ${storeKind}, innlogging: ${authMode})`);
});
