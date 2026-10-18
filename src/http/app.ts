// The HTTP side of the API, on node:http alone: it reads a request, asks who is behind it,
// calls the service and writes JSON back. The paths and shapes follow openapi.yaml.

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Authenticator } from "../auth/auth.ts";
import type { User } from "../domain/types.ts";
import { ApiError, type VillageService } from "../service.ts";

export const VERSION = "0.1.0";
const BODY_LIMIT = 64 * 1024;

type Params = Record<string, string>;
interface Context {
  params: Params;
  query: URLSearchParams;
  body: unknown;
  /** The signed-in user, or 401. */
  user: () => User;
}
type Handler = (context: Context) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
  /** The status of a successful answer. */
  status: number;
}

/** «/villages/:villageId/posts» as a pattern, with the names of its parts. */
function route(method: string, path: string, handler: Handler, status = 200): Route {
  const names: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/:([a-zA-Z]+)/g, (_, name: string) => (names.push(name), "([^/]+)")) + "/?$"
  );
  return { method, pattern, names, handler, status };
}

export interface AppOptions {
  service: VillageService;
  auth: Authenticator;
  /** Origins allowed to call from a browser on another address. Empty: the same address only. */
  corsOrigins?: string[];
  /** Folder with the web client, served at «/». */
  webRoot?: URL;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "DELETE") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new ApiError(413, "Forespørselen er for stor.");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "Innholdet er ikke gyldig JSON.");
  }
}

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (status === 204 || body === undefined) {
    response.writeHead(status === 200 && body === undefined ? 204 : status, headers).end();
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers }).end(JSON.stringify(body));
}

export function createApp(options: AppOptions): Server {
  const { service, auth } = options;
  const v = "/api/v1/villages/:villageId";
  const routes: Route[] = [
    route("GET", "/api/v1/health", async () => ({ ok: true, version: VERSION })),
    route("GET", "/api/v1/me", async ({ user }) => service.me(user())),
    route("GET", v, async ({ params }) => service.getVillage(params.villageId)),
    route("GET", `${v}/preview`, async ({ params }) => service.preview(params.villageId)),
    route("GET", `${v}/members`, async ({ params, user }) => service.members(params.villageId, user())),
    route("POST", `${v}/applications`, async ({ params, user, body }) => service.apply(params.villageId, user(), body), 201),
    route("GET", `${v}/applications`, async ({ params, user }) => service.applications(params.villageId, user())),
    route("POST", `${v}/applications/:applicationId/approve`, async ({ params, user, body }) =>
      service.approve(params.villageId, params.applicationId, user(), body)
    ),
    route("POST", `${v}/applications/:applicationId/reject`, async ({ params, user, body }) =>
      service.reject(params.villageId, params.applicationId, user(), body)
    ),
    route("GET", `${v}/posts`, async ({ params, user, query }) =>
      service.posts(params.villageId, user(), { kind: query.get("kind"), category: query.get("category"), tag: query.get("tag") })
    ),
    route("POST", `${v}/posts`, async ({ params, user, body }) => service.createPost(params.villageId, user(), body), 201),
    route("GET", `${v}/tags`, async ({ params, user }) => service.tags(params.villageId, user())),
    route("GET", `${v}/posts/:postId`, async ({ params, user }) => service.post(params.villageId, params.postId, user())),
    route("DELETE", `${v}/posts/:postId`, async ({ params, user }) => service.deletePost(params.villageId, params.postId, user()), 204),
    route("POST", `${v}/posts/:postId/close`, async ({ params, user }) => service.closePost(params.villageId, params.postId, user())),
    route("PUT", `${v}/posts/:postId/response`, async ({ params, user }) => service.answer(params.villageId, params.postId, user())),
    route("DELETE", `${v}/posts/:postId/response`, async ({ params, user }) => service.withdraw(params.villageId, params.postId, user())),
    route("GET", `${v}/posts/:postId/messages`, async ({ params, user, query }) =>
      service.messages(params.villageId, params.postId, user(), query.get("with"))
    ),
    route("POST", `${v}/posts/:postId/messages`, async ({ params, user, body }) =>
      service.sendMessage(params.villageId, params.postId, user(), body), 201
    ),
    route("GET", `${v}/conversations`, async ({ params, user }) => service.conversations(params.villageId, user())),
  ];

  const corsOrigins = options.corsOrigins ?? [];

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const origin = request.headers.origin;
    const cors: Record<string, string> =
      origin && corsOrigins.includes(origin)
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Dev-User",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            Vary: "Origin",
          }
        : {};

    try {
      if (request.method === "OPTIONS") return send(response, 204, undefined, cors);

      // The web client and the contract, outside the API
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
        if (url.pathname === "/openapi.yaml") {
          const spec = await readFile(new URL("../../openapi.yaml", import.meta.url), "utf8");
          response.writeHead(200, { "Content-Type": "application/yaml; charset=utf-8" }).end(spec);
          return;
        }
        if (options.webRoot && (url.pathname === "/" || url.pathname === "/index.html")) {
          const page = await readFile(new URL("index.html", options.webRoot), "utf8");
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page);
          return;
        }
      }

      for (const candidate of routes) {
        if (candidate.method !== request.method) continue;
        const match = candidate.pattern.exec(url.pathname);
        if (!match) continue;
        const params = Object.fromEntries(candidate.names.map((name, i) => [name, decodeURIComponent(match[i + 1])]));
        const signedIn = await auth.userOf(request.headers);
        const body = await readBody(request);
        const result = await candidate.handler({
          params,
          query: url.searchParams,
          body,
          user: () => {
            if (!signedIn) throw new ApiError(401, "Du må logge inn.");
            return signedIn;
          },
        });
        return send(response, result === undefined ? 204 : candidate.status, result, cors);
      }

      const pathKnown = routes.some((candidate) => candidate.pattern.test(url.pathname));
      send(response, pathKnown ? 405 : 404, { error: pathKnown ? "Metoden støttes ikke her." : "Finnes ikke." }, cors);
    } catch (error) {
      if (error instanceof ApiError) return send(response, error.status, { error: error.message }, cors);
      console.error(error);
      send(response, 500, { error: "Noe gikk galt hos oss. Prøv igjen om litt." }, cors);
    }
  });
}
