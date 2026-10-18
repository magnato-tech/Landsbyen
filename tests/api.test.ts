// The API end to end over HTTP: a real server on a free port, the made-up village in memory, and
// the test people signing in through the dev header. What each kind of person may and may not do.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { devAuth } from "../src/auth/auth.ts";
import { createApp } from "../src/http/app.ts";
import { DEMO_USERS, seedDemo } from "../src/seed.ts";
import { VillageService } from "../src/service.ts";
import { MemoryStore } from "../src/store/memoryStore.ts";

// A fixed Sunday morning in Oslo, so dates in the test data are known
const NOW = Date.parse("2026-10-18T10:00:00+02:00");
const store = new MemoryStore();
const server = createApp({
  service: new VillageService({ store, clock: { now: () => NOW } }),
  auth: devAuth(DEMO_USERS),
});
let base = "";

before(async () => {
  await seedDemo(store, NOW);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api/v1`;
});
after(() => server.close());

async function call(as: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as) headers["X-Dev-User"] = as;
  const answer = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await answer.text();
  return { status: answer.status, body: text ? JSON.parse(text) : null };
}

const V = "/villages/eksempelby";

describe("Uten innlogging", () => {
  test("presentasjonen og utdraget kan leses, med forankringen synlig og uten navn", async () => {
    const village = await call(null, "GET", V);
    assert.equal(village.status, 200);
    assert.equal(village.body.anchor.type, "menighet");
    assert.ok(village.body.rules.length > 0);

    const preview = await call(null, "GET", `${V}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.postsOnTorget, 7);
    assert.deepEqual(Object.keys(preview.body.upcomingInvitations[0]).sort(), ["category", "tags", "title", "when"]);
    assert.ok(!JSON.stringify(preview.body).includes("Nordmann"));
  });

  test("torget krever innlogging", async () => {
    assert.equal((await call(null, "GET", `${V}/posts`)).status, 401);
    assert.equal((await call(null, "GET", "/me")).status, 401);
  });
});

describe("Søknad og godkjenning", () => {
  test("en ny ser ikke torget før en vert har godkjent søknaden", async () => {
    assert.equal((await call("jonas", "GET", `${V}/posts`)).status, 403);

    const refused = await call("jonas", "POST", `${V}/applications`, { name: "Jonas Ny", acceptedRules: false });
    assert.equal(refused.status, 400);

    const applied = await call("jonas", "POST", `${V}/applications`, { name: "Jonas Ny", area: "Sentrum", acceptedRules: true });
    assert.equal(applied.status, 201);
    assert.equal(applied.body.status, "venter");
    assert.equal((await call("jonas", "POST", `${V}/applications`, { name: "Jonas Ny", acceptedRules: true })).status, 409);
    assert.deepEqual((await call("jonas", "GET", "/me")).body.pendingApplications, ["eksempelby"]);

    // Only a host decides
    assert.equal((await call("kari", "POST", `${V}/applications/${applied.body.id}/approve`)).status, 403);
    const waiting = await call("anne", "GET", `${V}/applications`);
    assert.deepEqual(waiting.body.map((a: { name: string }) => a.name), ["Per Nabo", "Jonas Ny"]);

    const approved = await call("anne", "POST", `${V}/applications/${applied.body.id}/approve`, { welcome: "Velkommen, Jonas!" });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.role, "landsbyboer");
    assert.equal((await call("anne", "POST", `${V}/applications/${applied.body.id}/approve`)).status, 409);

    assert.equal((await call("jonas", "GET", `${V}/posts`)).status, 200);
    assert.deepEqual((await call("jonas", "GET", "/me")).body.memberships, [{ villageId: "eksempelby", role: "landsbyboer" }]);
  });

  test("en vert kan avslå, og en vert kan ikke gjøre noen til vert", async () => {
    assert.equal((await call("anne", "POST", `${V}/applications/soknad-per/approve`, { role: "vert" })).status, 400);
    const rejected = await call("anne", "POST", `${V}/applications/soknad-per/reject`, { reason: "Bor utenfor området." });
    assert.equal(rejected.body.status, "avslatt");
    assert.equal((await call("per", "GET", `${V}/posts`)).status, 403);
  });

  test("medlemmer ser navn og rolle, vertene ser også område og dato", async () => {
    const asKari = (await call("kari", "GET", `${V}/members`)).body;
    assert.equal(asKari[0].role, "vert");
    assert.deepEqual(Object.keys(asKari[1]).sort(), ["name", "role", "userId"]);
    const asAnne = (await call("anne", "GET", `${V}/members`)).body;
    assert.ok(asAnne.some((m: { area?: string }) => m.area === "Sentrum"));
  });
});

describe("Torget", () => {
  test("en diskret forespørsel finnes bare for den som skrev den og for vertene", async () => {
    const titles = async (who: string) => (await call(who, "GET", `${V}/posts`)).body.map((p: { title: string }) => p.title);
    assert.ok(!(await titles("kari")).includes("Hjelp med handling noen uker"));
    assert.ok((await titles("sara")).includes("Hjelp med handling noen uker"));
    assert.ok((await titles("anne")).includes("Hjelp med handling noen uker"));
    assert.equal((await call("kari", "GET", `${V}/posts/innlegg-handling`)).status, 404);
  });

  test("legge ut, svare, se svaret og trekke det", async () => {
    const created = await call("ola", "POST", `${V}/posts`, {
      kind: "invitasjon",
      title: "Kaffe etter gudstjenesten",
      tags: ["#Kaffe"],
      when: "2026-10-25T12:30:00+01:00",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.authorName, "Ola Nordmann");
    assert.equal(created.body.lastDay, "2026-10-25");
    assert.deepEqual(created.body.tags, ["kaffe"]);
    assert.equal(created.body.action, null, "ingen knapp på eget innlegg");

    const id = created.body.id;
    assert.equal((await call("ola", "PUT", `${V}/posts/${id}/response`)).status, 409);

    const answered = await call("sara", "PUT", `${V}/posts/${id}/response`);
    assert.equal(answered.status, 200);
    assert.equal(answered.body.myAnswer, "blir-med");
    assert.equal(answered.body.answersLine, "Sara Innflytter blir med");
    // Pressing twice is one answer
    assert.equal((await call("sara", "PUT", `${V}/posts/${id}/response`)).body.responses.length, 1);

    const asOla = await call("ola", "GET", `${V}/posts/${id}`);
    assert.equal(asOla.body.answersLine, "Sara Innflytter blir med");

    const withdrawn = await call("sara", "DELETE", `${V}/posts/${id}/response`);
    assert.equal(withdrawn.body.answersLine, null);

    assert.deepEqual((await call("kari", "GET", `${V}/posts?tag=%23kaffe`)).body.map((p: { id: string }) => p.id), [id]);
    assert.ok((await call("kari", "GET", `${V}/tags`)).body.includes("kaffe"));
  });

  test("den som skrev innlegget, eller en vert, avslutter og sletter det; ingen andre", async () => {
    assert.equal((await call("kari", "POST", `${V}/posts/innlegg-nokkel/close`)).status, 403);
    const closed = await call("ola", "POST", `${V}/posts/innlegg-nokkel/close`);
    assert.ok(closed.body.closedAt);
    const ids = (await call("kari", "GET", `${V}/posts`)).body.map((p: { id: string }) => p.id);
    assert.ok(!ids.includes("innlegg-nokkel"));

    assert.equal((await call("sara", "DELETE", `${V}/posts/innlegg-tur`)).status, 403);
    assert.equal((await call("anne", "DELETE", `${V}/posts/innlegg-tur`)).status, 204);
    assert.equal((await call("kari", "GET", `${V}/posts/innlegg-tur`)).status, 404);
  });

  test("invitasjonene kan snevres inn til én kategori", async () => {
    const turer = (await call("kari", "GET", `${V}/posts?kind=invitasjon&category=aktivitet`)).body;
    assert.deepEqual(turer.map((p: { title: string; category: string }) => [p.title, p.category]), [["Fotball for alle på løkka", "aktivitet"]]);
    assert.equal((await call("kari", "GET", `${V}/posts?category=fest`)).status, 400);
  });

  test("feil i et innlegg sies på norsk", async () => {
    const answer = await call("kari", "POST", `${V}/posts`, { kind: "info", title: "" });
    assert.deepEqual(answer, { status: 400, body: { error: "Skriv en overskrift." } });
  });
});

describe("Private meldinger", () => {
  test("den som spurte og den som svarte kan skrive sammen; andre kan ikke lese eller skrive", async () => {
    const talk = await call("ola", "GET", `${V}/posts/innlegg-skyss/messages?with=kari`);
    assert.deepEqual(talk.body.map((m: { fromId: string }) => m.fromId), ["ola", "kari"]);

    const sent = await call("kari", "POST", `${V}/posts/innlegg-skyss/messages`, { to: "ola", text: "Sees i morgen!" });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.fromName, "Kari Nordmann");

    assert.equal((await call("sara", "GET", `${V}/posts/innlegg-skyss/messages?with=ola`)).status, 403);
    assert.equal((await call("sara", "POST", `${V}/posts/innlegg-skyss/messages`, { to: "ola", text: "Hei" })).status, 403);

    const conversations = (await call("ola", "GET", `${V}/conversations`)).body;
    assert.equal(conversations[0].withName, "Kari Nordmann");
    assert.equal(conversations[0].lastText, "Sees i morgen!");
    assert.equal((await call("sara", "GET", `${V}/conversations`)).body.length, 0);
  });
});

test("ukjente adresser og metoder", async () => {
  assert.equal((await call("kari", "GET", "/finnes-ikke")).status, 404);
  assert.equal((await call("kari", "PATCH", `${V}/posts`)).status, 405);
  assert.equal((await call(null, "GET", "/villages/ingen")).status, 404);
});
