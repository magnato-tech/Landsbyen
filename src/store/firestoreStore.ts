// The store in Google Cloud: Firestore, spoken to over its REST interface with plain fetch, so
// the app has no packages to install. Each village is one document with its parts under it:
//
//   villages/{villageId}
//   villages/{villageId}/members/{userId}
//   villages/{villageId}/applications/{applicationId}
//   villages/{villageId}/posts/{postId}
//   villages/{villageId}/responses/{postId}_{userId}
//   villages/{villageId}/messages/{messageId}
//
// The server is the only one who reads and writes, and it decides who may see what (the API
// checks every request). The database itself is closed to everyone else: see firestore.rules.
//
// Credentials: on Cloud Run the service account's token is fetched from the metadata server.
// Elsewhere GOOGLE_ACCESS_TOKEN can be given, and with FIRESTORE_EMULATOR_HOST the local
// emulator is used without any token.
//
// This is a concept: lists are read whole and filtered in the server, which is fine for a
// village of a few hundred people and should become queries before it grows past that.

import type { Application, Member, Message, Post, PostResponse, Village } from "../domain/types.ts";
import type { Store } from "./store.ts";

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

export function toValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === "object") return { mapValue: { fields: toFields(value as Record<string, unknown>) } };
  throw new Error(`Kan ikke lagre verdien ${String(value)}`);
}

/** The fields of a document. A field that is undefined is left out, as Firestore wants. */
export function toFields(object: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(object)) if (value !== undefined) fields[key] = toValue(value);
  return fields;
}

export function fromValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("stringValue" in value) return value.stringValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(fromValue);
  return fromFields(value.mapValue.fields ?? {});
}

export function fromFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)]));
}

export interface FirestoreOptions {
  projectId: string;
  databaseId?: string;
  /** host:port of the local emulator. */
  emulatorHost?: string;
  /** A fixed token, mostly for trying it out from a laptop. */
  accessToken?: string;
  fetch?: typeof fetch;
}

const METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export class FirestoreStore implements Store {
  private readonly base: string;
  private readonly root: string;
  private readonly options: FirestoreOptions;
  private readonly fetch: typeof fetch;
  private token: { value: string; until: number } | null = null;

  constructor(options: FirestoreOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    const database = options.databaseId ?? "(default)";
    const host = options.emulatorHost ? `http://${options.emulatorHost}` : "https://firestore.googleapis.com";
    this.root = `projects/${options.projectId}/databases/${database}/documents`;
    this.base = `${host}/v1/${this.root}`;
  }

  private async headers(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.emulatorHost) return { ...headers, Authorization: "Bearer owner" };
    if (this.options.accessToken) return { ...headers, Authorization: `Bearer ${this.options.accessToken}` };
    if (!this.token || this.token.until < Date.now() + 60_000) {
      const answer = await this.fetch(METADATA_TOKEN, { headers: { "Metadata-Flavor": "Google" } });
      if (!answer.ok) throw new Error("Fikk ikke tilgang til Firestore: ingen token fra Google Cloud.");
      const body = (await answer.json()) as { access_token: string; expires_in: number };
      this.token = { value: body.access_token, until: Date.now() + body.expires_in * 1000 };
    }
    return { ...headers, Authorization: `Bearer ${this.token.value}` };
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const answer = await this.fetch(url, { ...init, headers: { ...(await this.headers()), ...(init.headers ?? {}) } });
    if (!answer.ok && answer.status !== 404) {
      throw new Error(`Firestore svarte ${answer.status}: ${await answer.text()}`);
    }
    return answer;
  }

  private async get<T>(path: string): Promise<T | null> {
    const answer = await this.call(`${this.base}/${path}`);
    if (answer.status === 404) return null;
    const document = (await answer.json()) as FirestoreDocument;
    return fromFields(document.fields ?? {}) as T;
  }

  private async put(path: string, data: object): Promise<void> {
    await this.call(`${this.base}/${path}`, { method: "PATCH", body: JSON.stringify({ fields: toFields(data as Record<string, unknown>) }) });
  }

  private async remove(path: string): Promise<void> {
    await this.call(`${this.base}/${path}`, { method: "DELETE" });
  }

  private async list<T>(collectionPath: string): Promise<T[]> {
    const items: T[] = [];
    let pageToken = "";
    do {
      const answer = await this.call(`${this.base}/${collectionPath}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      if (answer.status === 404) return items;
      const body = (await answer.json()) as { documents?: FirestoreDocument[]; nextPageToken?: string };
      for (const document of body.documents ?? []) items.push(fromFields(document.fields ?? {}) as T);
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return items;
  }

  /** Every document named `collectionId` anywhere, where `field` equals `value`. */
  private async across<T>(collectionId: string, field: string, value: string): Promise<T[]> {
    const answer = await this.call(`${this.base}:runQuery`, {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId, allDescendants: true }],
          where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } },
        },
      }),
    });
    const rows = (await answer.json()) as { document?: FirestoreDocument }[];
    return rows.filter((row) => row.document).map((row) => fromFields(row.document!.fields ?? {}) as T);
  }

  private village = (villageId: string) => `villages/${encodeURIComponent(villageId)}`;
  private part = (villageId: string, collection: string, id: string) =>
    `${this.village(villageId)}/${collection}/${encodeURIComponent(id)}`;

  getVillage(villageId: string) {
    return this.get<Village>(this.village(villageId));
  }
  putVillage(village: Village) {
    return this.put(this.village(village.id), village);
  }

  getMember(villageId: string, userId: string) {
    return this.get<Member>(this.part(villageId, "members", userId));
  }
  listMembers(villageId: string) {
    return this.list<Member>(`${this.village(villageId)}/members`);
  }
  membershipsOf(userId: string) {
    return this.across<Member>("members", "userId", userId);
  }
  putMember(member: Member) {
    return this.put(this.part(member.villageId, "members", member.userId), member);
  }

  getApplication(villageId: string, applicationId: string) {
    return this.get<Application>(this.part(villageId, "applications", applicationId));
  }
  listApplications(villageId: string) {
    return this.list<Application>(`${this.village(villageId)}/applications`);
  }
  applicationsOf(userId: string) {
    return this.across<Application>("applications", "userId", userId);
  }
  putApplication(application: Application) {
    return this.put(this.part(application.villageId, "applications", application.id), application);
  }

  getPost(villageId: string, postId: string) {
    return this.get<Post>(this.part(villageId, "posts", postId));
  }
  listPosts(villageId: string) {
    return this.list<Post>(`${this.village(villageId)}/posts`);
  }
  putPost(post: Post) {
    return this.put(this.part(post.villageId, "posts", post.id), post);
  }
  async deletePost(villageId: string, postId: string) {
    for (const response of await this.listResponses(villageId, postId)) {
      await this.deleteResponse(villageId, postId, response.userId);
    }
    for (const message of await this.listMessages(villageId, postId)) {
      await this.remove(this.part(villageId, "messages", message.id));
    }
    await this.remove(this.part(villageId, "posts", postId));
  }

  async listResponses(villageId: string, postId?: string) {
    const all = await this.list<PostResponse>(`${this.village(villageId)}/responses`);
    return postId ? all.filter((r) => r.postId === postId) : all;
  }
  putResponse(response: PostResponse) {
    return this.put(this.part(response.villageId, "responses", `${response.postId}_${response.userId}`), response);
  }
  deleteResponse(villageId: string, postId: string, userId: string) {
    return this.remove(this.part(villageId, "responses", `${postId}_${userId}`));
  }

  async listMessages(villageId: string, postId?: string) {
    const all = await this.list<Message>(`${this.village(villageId)}/messages`);
    return postId ? all.filter((m) => m.postId === postId) : all;
  }
  putMessage(message: Message) {
    return this.put(this.part(message.villageId, "messages", message.id), message);
  }
}
