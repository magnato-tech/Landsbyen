// The client's view of the API: one method per endpoint in openapi.yaml. Two ways to reach it:
// over HTTP to a running server (httpApi), or inside the page itself with the same service and
// test data (localApi) for the demo that needs no server.

import type { Application, Member, Message, Village } from "../src/domain/types.ts";
import type { PostView, VillageService } from "../src/service.ts";
import { ApiError } from "../src/service.ts";

export type Me = Awaited<ReturnType<VillageService["me"]>>;
export type Preview = Awaited<ReturnType<VillageService["preview"]>>;
export type MemberView = Pick<Member, "userId" | "name" | "role"> & Partial<Pick<Member, "joinedAt" | "area">>;
export type Conversation = Awaited<ReturnType<VillageService["conversations"]>>[number];

export interface LandsbyApi {
  me(): Promise<Me>;
  village(): Promise<Village>;
  preview(): Promise<Preview>;
  members(): Promise<MemberView[]>;
  apply(input: { name: string; area?: string; connection?: string; acceptedRules: boolean }): Promise<Application>;
  applications(): Promise<Application[]>;
  approve(applicationId: string, input: { role: "landsbyboer" | "medlem"; welcome?: string }): Promise<MemberView>;
  reject(applicationId: string): Promise<Application>;
  posts(query: { kind?: string; category?: string; tag?: string }): Promise<PostView[]>;
  createPost(input: Record<string, unknown>): Promise<PostView>;
  closePost(postId: string): Promise<PostView>;
  deletePost(postId: string): Promise<void>;
  answer(postId: string): Promise<PostView>;
  withdraw(postId: string): Promise<PostView>;
  messages(postId: string, withId: string): Promise<Message[]>;
  sendMessage(postId: string, to: string, text: string): Promise<Message>;
  conversations(): Promise<Conversation[]>;
}

/** A running server. `headers` says who is asking: a Bearer token, or X-Dev-User in development. */
export function httpApi(base: string, villageId: string, headers: () => Record<string, string>): LandsbyApi {
  const v = `${base}/api/v1/villages/${encodeURIComponent(villageId)}`;
  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const answer = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await answer.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!answer.ok) throw new ApiError(answer.status, data?.error ?? "Noe gikk galt.");
    return data as T;
  }
  const q = (query: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value) as [string, string][]);
    return params.size ? `?${params}` : "";
  };
  return {
    me: () => call("GET", `${base}/api/v1/me`),
    village: () => call("GET", v),
    preview: () => call("GET", `${v}/preview`),
    members: () => call("GET", `${v}/members`),
    apply: (input) => call("POST", `${v}/applications`, input),
    applications: () => call("GET", `${v}/applications`),
    approve: (id, input) => call("POST", `${v}/applications/${id}/approve`, input),
    reject: (id) => call("POST", `${v}/applications/${id}/reject`, {}),
    posts: (query) => call("GET", `${v}/posts${q(query)}`),
    createPost: (input) => call("POST", `${v}/posts`, input),
    closePost: (id) => call("POST", `${v}/posts/${id}/close`),
    deletePost: (id) => call("DELETE", `${v}/posts/${id}`),
    answer: (id) => call("PUT", `${v}/posts/${id}/response`),
    withdraw: (id) => call("DELETE", `${v}/posts/${id}/response`),
    messages: (id, withId) => call("GET", `${v}/posts/${id}/messages${q({ with: withId })}`),
    sendMessage: (id, to, text) => call("POST", `${v}/posts/${id}/messages`, { to, text }),
    conversations: () => call("GET", `${v}/conversations`),
  };
}

/** The same service in the page, for the demo. `user` says who is looking. */
export function localApi(service: VillageService, villageId: string, user: () => { id: string; name: string } | null): LandsbyApi {
  const who = () => {
    const current = user();
    if (!current) throw new ApiError(401, "Du må logge inn.");
    return current;
  };
  return {
    me: () => service.me(who()),
    village: () => service.getVillage(villageId),
    preview: () => service.preview(villageId),
    members: () => service.members(villageId, who()),
    apply: (input) => service.apply(villageId, who(), input),
    applications: () => service.applications(villageId, who()),
    approve: (id, input) => service.approve(villageId, id, who(), input),
    reject: (id) => service.reject(villageId, id, who(), {}),
    posts: (query) => service.posts(villageId, who(), query),
    createPost: (input) => service.createPost(villageId, who(), input),
    closePost: (id) => service.closePost(villageId, id, who()),
    deletePost: (id) => service.deletePost(villageId, id, who()),
    answer: (id) => service.answer(villageId, id, who()),
    withdraw: (id) => service.withdraw(villageId, id, who()),
    messages: (id, withId) => service.messages(villageId, id, who(), withId),
    sendMessage: (id, to, text) => service.sendMessage(villageId, id, who(), { to, text }),
    conversations: () => service.conversations(villageId, who()),
  };
}
