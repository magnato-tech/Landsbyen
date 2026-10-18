// Sign-in with a Google account through Firebase Authentication. The client signs in with the
// Firebase web SDK and sends the ID token; here the token's signature and claims are checked
// against Google's public keys, with nothing but node:crypto and fetch.
//
// What is checked follows Firebase's guide for verifying ID tokens with a third-party library:
// RS256, a key id Google has published, audience = the Firebase project, issuer =
// https://securetoken.google.com/<project>, not expired, not issued in the future, a subject.

import { createPublicKey, verify } from "node:crypto";
import type { User } from "../domain/types.ts";
import type { Authenticator } from "./auth.ts";

const KEYS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

interface TokenClaims {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

const decodePart = <T>(part: string): T => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;

/** The checks on the claims alone, apart from the signature, so they can be tested without Google. */
export function claimsProblem(claims: TokenClaims, projectId: string, nowSeconds: number): string | null {
  if (claims.aud !== projectId) return "feil prosjekt";
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) return "feil utsteder";
  if (!claims.sub) return "mangler bruker";
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return "utløpt";
  if (typeof claims.iat !== "number" || claims.iat > nowSeconds + 300) return "utstedt fram i tid";
  if (typeof claims.auth_time === "number" && claims.auth_time > nowSeconds + 300) return "innlogget fram i tid";
  return null;
}

export function googleAuth(projectId: string, fetchKeys: typeof fetch = fetch): Authenticator {
  let keys: { certificates: Record<string, string>; until: number } | null = null;

  async function certificates(): Promise<Record<string, string>> {
    if (keys && keys.until > Date.now()) return keys.certificates;
    const answer = await fetchKeys(KEYS_URL);
    if (!answer.ok) throw new Error("Fikk ikke hentet Googles nøkler for innlogging.");
    const maxAge = Number(/max-age=(\d+)/.exec(answer.headers.get("cache-control") ?? "")?.[1] ?? 3600);
    keys = { certificates: (await answer.json()) as Record<string, string>, until: Date.now() + maxAge * 1000 };
    return keys.certificates;
  }

  return {
    async userOf(headers) {
      const header = headers.authorization;
      if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
      const parts = header.slice(7).trim().split(".");
      if (parts.length !== 3) return null;
      try {
        const head = decodePart<{ alg?: string; kid?: string }>(parts[0]);
        const claims = decodePart<TokenClaims>(parts[1]);
        if (head.alg !== "RS256" || !head.kid) return null;
        const certificate = (await certificates())[head.kid];
        if (!certificate) return null;
        const signed = verify(
          "RSA-SHA256",
          Buffer.from(`${parts[0]}.${parts[1]}`),
          createPublicKey(certificate),
          Buffer.from(parts[2], "base64url")
        );
        if (!signed || claimsProblem(claims, projectId, Math.floor(Date.now() / 1000))) return null;
        const user: User = { id: claims.sub!, name: claims.name || claims.email || "Uten navn" };
        if (claims.email && claims.email_verified) user.email = claims.email;
        return user;
      } catch {
        // A token that cannot be read is no sign-in
        return null;
      }
    },
  };
}
