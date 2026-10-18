// The demo that needs no server: the same service and the same made-up village, run inside the
// page. Everything starts over when the page is reloaded.

import { DEMO_USERS, DEMO_VILLAGE_ID, seedDemo } from "../src/seed.ts";
import { VillageService } from "../src/service.ts";
import { MemoryStore } from "../src/store/memoryStore.ts";
import { localApi } from "./api.ts";
import { startApp } from "./app.ts";

const store = new MemoryStore();
const service = new VillageService({ store });
let person = "kari";

await seedDemo(store);

startApp({
  root: document.getElementById("app")!,
  api: localApi(service, DEMO_VILLAGE_ID, () => DEMO_USERS.find((u) => u.id === person) ?? null),
  villageId: DEMO_VILLAGE_ID,
  people: DEMO_USERS,
  currentPerson: () => person,
  setPerson: (id) => {
    person = id;
  },
  demoNote: "Alt her er oppdiktet, og demoen starter på nytt når siden lastes.",
});
