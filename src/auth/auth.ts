// Who is asking. In operation: a Google account through Firebase Authentication, whose ID token
// the client sends as «Authorization: Bearer …» (googleAuth.ts). On a laptop and in the demo:
// a header naming one of the test people (devAuth below). The API never trusts a name or an id
// the client writes in the body.

import type { IncomingHttpHeaders } from "node:http";
import type { User } from "../domain/types.ts";

export interface Authenticator {
  /** The user behind the request, or null when nobody valid is signed in. */
  userOf(headers: IncomingHttpHeaders): Promise<User | null>;
}

/** Only for a laptop, the tests and the demo: «X-Dev-User: <id>» picks one of the people given. */
export function devAuth(users: readonly User[]): Authenticator {
  return {
    async userOf(headers) {
      const id = headers["x-dev-user"];
      if (typeof id !== "string") return null;
      return users.find((user) => user.id === id) ?? null;
    },
  };
}
