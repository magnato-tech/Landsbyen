// Sign-in with Google and the Firestore format, tried without reaching Google: a key pair made
// here stands in for Google's keys, and the Firestore values are turned back and forth.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { claimsProblem, googleAuth } from "../src/auth/googleAuth.ts";
import { fromFields, toFields } from "../src/store/firestoreStore.ts";

const PROJECT = "landsbyen-test";
const now = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  sub: "uid-123",
  iat: now() - 10,
  exp: now() + 3600,
  name: "Kari Nordmann",
  email: "kari@eksempel.no",
  email_verified: true,
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keysOnline = (async () =>
  new Response(JSON.stringify({ k1: publicKey.export({ type: "spki", format: "pem" }) }), {
    headers: { "cache-control": "public, max-age=600" },
  })) as unknown as typeof fetch;

function token(claims: object, kid = "k1", key = privateKey): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", kid, typ: "JWT" })}.${part(claims)}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
}

describe("Innlogging med Google", () => {
  const auth = googleAuth(PROJECT, keysOnline);
  const asking = (bearer: string) => auth.userOf({ authorization: `Bearer ${bearer}` });

  test("et gyldig token gir brukeren, med navn og bekreftet e-post", async () => {
    assert.deepEqual(await asking(token(goodClaims())), { id: "uid-123", name: "Kari Nordmann", email: "kari@eksempel.no" });
  });

  test("feil prosjekt, utløpt, ukjent nøkkel eller falsk signatur gir ingen innlogging", async () => {
    assert.equal(await asking(token({ ...goodClaims(), aud: "et-annet" })), null);
    assert.equal(await asking(token({ ...goodClaims(), exp: now() - 1 })), null);
    assert.equal(await asking(token(goodClaims(), "ukjent")), null);
    const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    assert.equal(await asking(token(goodClaims(), "k1", stranger)), null);
    assert.equal(await asking("ikke.et.token"), null);
    assert.equal(await auth.userOf({}), null);
  });

  test("en e-post som ikke er bekreftet, tas ikke med", async () => {
    assert.deepEqual(await asking(token({ ...goodClaims(), email_verified: false })), { id: "uid-123", name: "Kari Nordmann" });
  });

  test("kravene til innholdet i tokenet", () => {
    const t = now();
    assert.equal(claimsProblem(goodClaims(), PROJECT, t), null);
    assert.equal(claimsProblem({ ...goodClaims(), iss: "https://annen" }, PROJECT, t), "feil utsteder");
    assert.equal(claimsProblem({ ...goodClaims(), sub: "" }, PROJECT, t), "mangler bruker");
    assert.equal(claimsProblem({ ...goodClaims(), iat: t + 3600 }, PROJECT, t), "utstedt fram i tid");
  });
});

test("Firestore-formatet: det som lagres, kommer likt tilbake, uten tomme felt", () => {
  const post = {
    id: "innlegg-1",
    title: "Tur",
    tags: ["tur", "barn"],
    discreet: false,
    count: 3,
    share: 0.5,
    anchor: { type: "menighet", name: "Eksempelby menighet" },
    closedAt: undefined,
    nothing: null,
  };
  const stored = toFields(post);
  assert.equal("closedAt" in stored, false);
  assert.deepEqual(stored.count, { integerValue: "3" });
  const { closedAt: _gone, ...expected } = post;
  assert.deepEqual(fromFields(stored), expected);
});
