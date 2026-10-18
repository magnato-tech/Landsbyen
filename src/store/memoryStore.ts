// A store in memory, for a laptop, the tests and the demo. With a file name, everything is also
// written to that file after each change and read back at start, so a restart keeps the village.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Application, Member, Message, Post, PostResponse, Village } from "../domain/types.ts";
import type { Store } from "./store.ts";

interface Data {
  villages: Village[];
  members: Member[];
  applications: Application[];
  posts: Post[];
  responses: PostResponse[];
  messages: Message[];
}

const empty = (): Data => ({ villages: [], members: [], applications: [], posts: [], responses: [], messages: [] });
const copy = <T>(value: T): T => structuredClone(value);

export class MemoryStore implements Store {
  private data: Data;
  private readonly file: string | undefined;

  constructor(file?: string) {
    this.file = file;
    this.data = file && existsSync(file) ? { ...empty(), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<Data>) } : empty();
  }

  private save(): void {
    if (this.file) writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /** Replaces one item that matches, or adds it. */
  private upsert<T>(list: T[], item: T, same: (a: T) => boolean): void {
    const index = list.findIndex(same);
    if (index >= 0) list[index] = copy(item);
    else list.push(copy(item));
    this.save();
  }

  async getVillage(villageId: string) {
    return copy(this.data.villages.find((v) => v.id === villageId) ?? null);
  }
  async putVillage(village: Village) {
    this.upsert(this.data.villages, village, (v) => v.id === village.id);
  }

  async getMember(villageId: string, userId: string) {
    return copy(this.data.members.find((m) => m.villageId === villageId && m.userId === userId) ?? null);
  }
  async listMembers(villageId: string) {
    return copy(this.data.members.filter((m) => m.villageId === villageId));
  }
  async membershipsOf(userId: string) {
    return copy(this.data.members.filter((m) => m.userId === userId));
  }
  async putMember(member: Member) {
    this.upsert(this.data.members, member, (m) => m.villageId === member.villageId && m.userId === member.userId);
  }

  async getApplication(villageId: string, applicationId: string) {
    return copy(this.data.applications.find((a) => a.villageId === villageId && a.id === applicationId) ?? null);
  }
  async listApplications(villageId: string) {
    return copy(this.data.applications.filter((a) => a.villageId === villageId));
  }
  async applicationsOf(userId: string) {
    return copy(this.data.applications.filter((a) => a.userId === userId));
  }
  async putApplication(application: Application) {
    this.upsert(this.data.applications, application, (a) => a.id === application.id);
  }

  async getPost(villageId: string, postId: string) {
    return copy(this.data.posts.find((p) => p.villageId === villageId && p.id === postId) ?? null);
  }
  async listPosts(villageId: string) {
    return copy(this.data.posts.filter((p) => p.villageId === villageId));
  }
  async putPost(post: Post) {
    this.upsert(this.data.posts, post, (p) => p.id === post.id);
  }
  async deletePost(villageId: string, postId: string) {
    const other = <T extends { villageId: string; postId?: string; id?: string }>(item: T) =>
      !(item.villageId === villageId && (item.postId ?? item.id) === postId);
    this.data.posts = this.data.posts.filter((p) => !(p.villageId === villageId && p.id === postId));
    this.data.responses = this.data.responses.filter(other);
    this.data.messages = this.data.messages.filter(other);
    this.save();
  }

  async listResponses(villageId: string, postId?: string) {
    return copy(this.data.responses.filter((r) => r.villageId === villageId && (!postId || r.postId === postId)));
  }
  async putResponse(response: PostResponse) {
    this.upsert(
      this.data.responses,
      response,
      (r) => r.villageId === response.villageId && r.postId === response.postId && r.userId === response.userId
    );
  }
  async deleteResponse(villageId: string, postId: string, userId: string) {
    this.data.responses = this.data.responses.filter((r) => !(r.villageId === villageId && r.postId === postId && r.userId === userId));
    this.save();
  }

  async listMessages(villageId: string, postId?: string) {
    return copy(this.data.messages.filter((m) => m.villageId === villageId && (!postId || m.postId === postId)));
  }
  async putMessage(message: Message) {
    this.upsert(this.data.messages, message, (m) => m.id === message.id);
  }
}
