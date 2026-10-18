import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  answerRefusal,
  answersLine,
  cleanTags,
  isOnTorget,
  mayMessage,
  maySeePost,
  namesInProse,
  readNewPost,
  tagsInUse,
  torget,
} from "../src/domain/torget.ts";
import { addDays, dayIn, isIsoDay, momentIn } from "../src/domain/days.ts";
import { readApplication, readApproval } from "../src/domain/applications.ts";
import type { Post, PostResponse } from "../src/domain/types.ts";

const TODAY = "2026-10-18";
const osloDay = (moment: string) => dayIn("Europe/Oslo", moment);

const post = (fields: Partial<Post>): Post => ({
  id: "p1",
  villageId: "v",
  kind: "invitasjon",
  title: "Tur",
  body: "",
  tags: [],
  lastDay: "2026-10-24",
  discreet: false,
  authorId: "kari",
  authorName: "Kari",
  createdAt: "2026-10-18T08:00:00.000Z",
  ...fields,
});

describe("Et nytt innlegg", () => {
  test("en invitasjon står til dagen den skjer, alt annet i fjorten dager", () => {
    const invitation = readNewPost({ kind: "invitasjon", title: " Tur  rundt vannet ", when: "2026-10-24T11:00:00+02:00" }, TODAY, osloDay);
    assert.ok(invitation.ok);
    assert.equal(invitation.value.title, "Tur rundt vannet");
    assert.equal(invitation.value.lastDay, "2026-10-24");
    assert.equal(invitation.value.when, "2026-10-24T09:00:00.000Z");

    const info = readNewPost({ kind: "info", title: "Funnet nøkkel" }, TODAY, osloDay);
    assert.ok(info.ok);
    assert.equal(info.value.lastDay, "2026-11-01");
  });

  test("dagen et tidspunkt faller på, regnes i landsbyens tidssone, ikke serverens", () => {
    // 23:30 in Oslo is the next day in UTC on the server; the post belongs to the Oslo day
    const late = readNewPost({ kind: "invitasjon", title: "Kveldstur", when: "2026-10-24T23:30:00+02:00" }, TODAY, osloDay);
    assert.ok(late.ok);
    assert.equal(late.value.lastDay, "2026-10-24");
  });

  test("et tidspunkt uten tidssone avvises, så telefon og server ikke leser det ulikt", () => {
    const result = readNewPost({ kind: "invitasjon", title: "Tur", when: "2026-10-24T11:00" }, TODAY, osloDay);
    assert.deepEqual(result, { ok: false, error: "Tidspunktet må være et tidspunkt med tidssone." });
  });

  test("det som mangler eller er for langt, sies tydelig", () => {
    assert.equal((readNewPost({ kind: "fest", title: "x" }, TODAY, osloDay) as { error: string }).error.startsWith("Velg hva"), true);
    assert.deepEqual(readNewPost({ kind: "info", title: "   " }, TODAY, osloDay), { ok: false, error: "Skriv en overskrift." });
    assert.equal(readNewPost({ kind: "info", title: "x".repeat(81) }, TODAY, osloDay).ok, false);
    assert.equal(readNewPost({ kind: "info", title: "x", body: "y".repeat(601) }, TODAY, osloDay).ok, false);
    assert.deepEqual(readNewPost({ kind: "info", title: "x", lastDay: "2026-10-17" }, TODAY, osloDay), { ok: false, error: "Siste dag har vært." });
    assert.equal(readNewPost({ kind: "info", title: "x", lastDay: addDays(TODAY, 91) }, TODAY, osloDay).ok, false);
    assert.equal(readNewPost({ kind: "info", title: "x", lastDay: addDays(TODAY, 90) }, TODAY, osloDay).ok, true);
  });

  test("bare en forespørsel om hjelp kan være diskret", () => {
    const help = readNewPost({ kind: "hjelp", title: "Handling", discreet: true }, TODAY, osloDay);
    assert.ok(help.ok);
    assert.equal(help.value.discreet, true);
    assert.equal(readNewPost({ kind: "invitasjon", title: "Fest", discreet: true }, TODAY, osloDay).ok, false);
  });

  test("tagger lagres med små bokstaver, uten #, uten gjentakelser og høyst fem", () => {
    assert.deepEqual(cleanTags(["#Tur", "tur", "Barn, #Middag", "ny-her!", "a", "b", "c"]), ["tur", "barn", "middag", "ny-her", "a"]);
    assert.deepEqual(cleanTags([42, null, "Høst"]), ["høst"]);
  });
});

describe("Torget", () => {
  const posts = [
    post({ id: "gammel", createdAt: "2026-10-01T08:00:00Z", lastDay: "2026-10-17" }),
    post({ id: "avsluttet", closedAt: "2026-10-18T07:00:00Z" }),
    post({ id: "tur", tags: ["tur"], createdAt: "2026-10-18T09:00:00Z" }),
    post({ id: "diskret", kind: "hjelp", discreet: true, authorId: "sara", createdAt: "2026-10-18T10:00:00Z", tags: ["handling"] }),
    post({ id: "info", kind: "info", tags: ["tur", "funnet"], createdAt: "2026-10-18T07:30:00Z" }),
  ];

  test("et utløpt eller avsluttet innlegg står ikke på torget", () => {
    assert.equal(isOnTorget(post({ lastDay: TODAY }), TODAY), true);
    assert.equal(isOnTorget(post({ lastDay: "2026-10-17" }), TODAY), false);
    assert.equal(isOnTorget(post({ closedAt: "x" }), TODAY), false);
  });

  test("en diskret forespørsel ses bare av den som skrev den og av vertene", () => {
    const discreet = post({ discreet: true, authorId: "sara" });
    assert.equal(maySeePost(discreet, "sara", "landsbyboer"), true);
    assert.equal(maySeePost(discreet, "anne", "vert"), true);
    assert.equal(maySeePost(discreet, "kari", "medlem"), false);

    assert.deepEqual(torget(posts, {}, { userId: "kari", role: "medlem" }, TODAY).map((p) => p.id), ["tur", "info"]);
    assert.deepEqual(torget(posts, {}, { userId: "anne", role: "vert" }, TODAY).map((p) => p.id), ["diskret", "tur", "info"]);
  });

  test("filtrering på type og tagg", () => {
    const kari = { userId: "kari", role: "medlem" as const };
    assert.deepEqual(torget(posts, { kind: "info" }, kari, TODAY).map((p) => p.id), ["info"]);
    assert.deepEqual(torget(posts, { tag: "tur" }, kari, TODAY).map((p) => p.id), ["tur", "info"]);
    assert.deepEqual(tagsInUse(torget(posts, {}, kari, TODAY)), ["tur", "funnet"]);
  });
});

describe("Svar og private meldinger", () => {
  const responses: PostResponse[] = [
    { villageId: "v", postId: "p1", userId: "sara", name: "Sara", answer: "blir-med", at: "1" },
    { villageId: "v", postId: "p1", userId: "anne", name: "Anne", answer: "blir-med", at: "2" },
  ];

  test("svarene sies som en setning", () => {
    assert.equal(namesInProse(["Kari"]), "Kari");
    assert.equal(namesInProse(["Kari", "Ola", "Per"]), "Kari, Ola og Per");
    assert.equal(answersLine("invitasjon", responses), "Sara og Anne blir med");
    assert.equal(answersLine("hjelp", []), null);
  });

  test("man svarer ikke på eget, diskret, utløpt eller info-innlegg", () => {
    assert.equal(answerRefusal(post({}), "sara", TODAY), null);
    assert.match(answerRefusal(post({}), "kari", TODAY)!, /eget/);
    assert.match(answerRefusal(post({ kind: "hjelp", discreet: true }), "sara", TODAY)!, /landsbyvertene/);
    assert.match(answerRefusal(post({ kind: "info" }), "sara", TODAY)!, /tar ikke svar/);
    assert.match(answerRefusal(post({ lastDay: "2026-10-01" }), "sara", TODAY)!, /ikke lenger/);
  });

  test("private meldinger går bare mellom den som spurte og den som svarte", () => {
    const p = post({});
    assert.equal(mayMessage(p, "kari", "sara", responses), true);
    assert.equal(mayMessage(p, "sara", "kari", responses), true);
    // Two who answered are strangers to each other here
    assert.equal(mayMessage(p, "sara", "anne", responses), false);
    assert.equal(mayMessage(p, "kari", "per", responses), false);
    assert.equal(mayMessage(p, "kari", "kari", responses), false);
  });
});

describe("Søknader og dager", () => {
  test("en søknad krever navn og at levereglene er godtatt", () => {
    assert.deepEqual(readApplication({ name: "Per", acceptedRules: false }), { ok: false, error: "Du må godta levereglene for å søke." });
    assert.deepEqual(readApplication({ name: " Per  Nabo ", area: "Bakken", acceptedRules: true }), {
      ok: true,
      value: { name: "Per Nabo", area: "Bakken" },
    });
  });

  test("en ny blir landsbyboer med mindre verten sier medlem, aldri vert", () => {
    assert.deepEqual(readApproval(undefined), { ok: true, value: { role: "landsbyboer" } });
    assert.deepEqual(readApproval({ role: "medlem", welcome: " Velkommen! " }), { ok: true, value: { role: "medlem", welcome: "Velkommen!" } });
    assert.equal(readApproval({ role: "vert" }).ok, false);
  });

  test("kalenderdager", () => {
    assert.equal(addDays("2026-10-24", 8), "2026-11-01");
    assert.equal(addDays("2026-03-28", 1), "2026-03-29");
    assert.equal(isIsoDay("2026-02-30"), false);
    assert.equal(isIsoDay("2026-10-18"), true);
    assert.equal(dayIn("Europe/Oslo", "2026-10-18T22:30:00Z"), "2026-10-19");
    // Summer time, winter time, and the night the clocks go back
    assert.equal(momentIn("2026-10-24", "11:00", "Europe/Oslo"), "2026-10-24T09:00:00.000Z");
    assert.equal(momentIn("2026-11-07", "11:00", "Europe/Oslo"), "2026-11-07T10:00:00.000Z");
    assert.equal(momentIn("2026-10-25", "12:00", "Europe/Oslo"), "2026-10-25T11:00:00.000Z");
  });
});
