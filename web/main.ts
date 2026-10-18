// The client served by the API itself, at «/». In development the server signs people in by the
// X-Dev-User header, so the page lets you pick one of the test people. With Google sign-in, a
// Firebase ID token goes in the Authorization header instead (see README.md).

import { DEMO_USERS, DEMO_VILLAGE_ID } from "../src/seed.ts";
import { httpApi } from "./api.ts";
import { startApp } from "./app.ts";

const KEY = "landsbyen-person";
let person = "kari";
try {
  person = localStorage.getItem(KEY) ?? person;
} catch {
  // Without storage the choice lasts until the page is reloaded
}

startApp({
  root: document.getElementById("app")!,
  api: httpApi("", DEMO_VILLAGE_ID, () => ({ "X-Dev-User": person })),
  villageId: DEMO_VILLAGE_ID,
  people: DEMO_USERS,
  currentPerson: () => person,
  setPerson: (id) => {
    person = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // As above
    }
  },
  demoNote: "Utviklingsmodus: testpersoner i stedet for innlogging med Google.",
});
