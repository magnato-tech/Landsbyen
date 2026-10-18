import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dayIn } from "../src/domain/days.ts";
import { ROOFTOPS, placeOnRoofs, roofPosts, type RoofPost } from "../web/village.ts";

const TODAY = "2026-10-18";
const osloDay = (moment: string) => dayIn("Europe/Oslo", moment);

describe("Den levende husrekka", () => {
  const posts: RoofPost[] = [
    { id: "neste-uke", kind: "invitasjon", category: "tur", title: "For langt fram", when: "2026-10-25T09:00:00Z" },
    { id: "lordag", kind: "invitasjon", category: "tur", title: "Tur", when: "2026-10-24T09:00:00Z" },
    { id: "i-dag", kind: "invitasjon", category: "mat", title: "Kaffe", when: "2026-10-18T13:00:00Z" },
    { id: "uten-tid", kind: "invitasjon", title: "Når som helst" },
    { id: "hjelp", kind: "hjelp", title: "Skyss", createdAt: "2026-10-17T10:00:00Z" },
    { id: "diskret", kind: "hjelp", title: "Handling", discreet: true, createdAt: "2026-10-18T09:00:00Z" },
    { id: "tilbud", kind: "tilbud", title: "Barnevakt", createdAt: "2026-10-16T10:00:00Z" },
    { id: "info", kind: "info", title: "Funnet nøkkel" },
  ];

  test("invitasjoner den neste uka først, så hjelp og tilbud; aldri diskret, aldri info", () => {
    assert.deepEqual(roofPosts(posts, TODAY, osloDay).map((p) => p.id), ["i-dag", "lordag", "hjelp", "tilbud"]);
  });

  test("høyst åtte symboler", () => {
    const many: RoofPost[] = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, kind: "hjelp", title: "x", createdAt: `2026-10-${10 + i}` }));
    assert.equal(roofPosts(many, TODAY, osloDay).length, 8);
    assert.equal(placeOnRoofs(roofPosts(many, TODAY, osloDay)).length, 8);
  });

  test("en samling står over kirken, resten fyller husene fra midten og utover", () => {
    const placed = placeOnRoofs([
      { id: "a", kind: "invitasjon", category: "tur", title: "a" },
      { id: "b", kind: "invitasjon", category: "samling", title: "b" },
      { id: "c", kind: "hjelp", title: "c" },
    ]);
    assert.deepEqual(placed.map((p) => [p.id, p.x]), [["a", 114], ["b", ROOFTOPS.church.x], ["c", 220]]);
  });
});
