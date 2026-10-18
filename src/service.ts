// What the API can do, one function per action, with every check of who may do it. The HTTP
// layer (http/app.ts) only reads the request and writes the answer; nothing here knows about
// HTTP beyond the status an ApiError carries.

import { byRoleThenName, readApplication, readApproval } from "./domain/applications.ts";
import { dayIn } from "./domain/days.ts";
import {
  KIND_INFO,
  answerRefusal,
  answersLine,
  conversation,
  isOnTorget,
  mayManagePost,
  mayMessage,
  maySeePost,
  readMessageText,
  readNewPost,
  responsesTo,
  tagsInUse,
  torget,
  type PostFilter,
} from "./domain/torget.ts";
import { INVITATION_CATEGORIES, POST_KINDS, type Application, type InvitationCategory, type Member, type Message, type Post, type PostKind, type PostResponse, type User, type Village } from "./domain/types.ts";
import type { Store } from "./store/store.ts";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const notFound = (what: string) => new ApiError(404, `Fant ikke ${what}.`);
const forbidden = (message = "Du har ikke tilgang til dette.") => new ApiError(403, message);

export interface PostView extends Post {
  responses: { userId: string; name: string; answer: PostResponse["answer"]; at: string }[];
  answersLine: string | null;
  mine: boolean;
  myAnswer: PostResponse["answer"] | null;
  action: string | null;
}

export interface Clock {
  now(): number;
}

export interface ServiceOptions {
  store: Store;
  clock?: Clock;
  newId?: (prefix: string) => string;
}

export function defaultId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export class VillageService {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly newId: (prefix: string) => string;

  constructor(options: ServiceOptions) {
    this.store = options.store;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.newId = options.newId ?? defaultId;
  }

  private nowIso = () => new Date(this.clock.now()).toISOString();

  private async village(villageId: string): Promise<Village> {
    const village = await this.store.getVillage(villageId);
    if (!village) throw notFound("landsbyen");
    return village;
  }

  private today = (village: Village) => dayIn(village.timeZone, this.clock.now());

  /** The member asking, or 403 for someone who is not in the village. */
  private async member(village: Village, user: User): Promise<Member> {
    const member = await this.store.getMember(village.id, user.id);
    if (!member) throw forbidden("Du er ikke med i denne landsbyen ennå. Søk om å bli med.");
    return member;
  }

  private async host(village: Village, user: User): Promise<Member> {
    const member = await this.member(village, user);
    if (member.role !== "vert") throw forbidden("Bare landsbyvertene kan gjøre dette.");
    return member;
  }

  private postView(post: Post, responses: readonly PostResponse[], viewer: Member): PostView {
    const answers = responsesTo(responses, post.id);
    const mine = answers.find((r) => r.userId === viewer.userId);
    const info = KIND_INFO[post.kind];
    return {
      ...post,
      responses: answers.map(({ userId, name, answer, at }) => ({ userId, name, answer, at })),
      answersLine: answersLine(post.kind, answers),
      mine: post.authorId === viewer.userId,
      myAnswer: mine?.answer ?? null,
      // The button shows only where pressing it would be let through
      action: post.authorId === viewer.userId || post.discreet ? null : info.action,
    };
  }

  // ---------- Me and the village ----------

  async me(user: User) {
    const memberships = await this.store.membershipsOf(user.id);
    const applications = await this.store.applicationsOf(user.id);
    return {
      userId: user.id,
      name: user.name,
      ...(user.email ? { email: user.email } : {}),
      memberships: memberships.map((m) => ({ villageId: m.villageId, role: m.role })),
      pendingApplications: applications.filter((a) => a.status === "venter").map((a) => a.villageId),
    };
  }

  getVillage(villageId: string): Promise<Village> {
    return this.village(villageId);
  }

  /** What someone thinking of applying may see: coming invitations and a count, no names, no requests for help. */
  async preview(villageId: string) {
    const village = await this.village(villageId);
    const today = this.today(village);
    const onTorget = (await this.store.listPosts(villageId)).filter((post) => isOnTorget(post, today) && !post.discreet);
    const upcomingInvitations = onTorget
      .filter((post) => post.kind === "invitasjon")
      .sort((a, b) => (a.when ?? a.lastDay).localeCompare(b.when ?? b.lastDay))
      .slice(0, 5)
      .map((post) => ({ title: post.title, ...(post.when ? { when: post.when } : {}), tags: post.tags }));
    return { postsOnTorget: onTorget.length, upcomingInvitations };
  }

  async members(villageId: string, user: User) {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const members = (await this.store.listMembers(villageId)).sort(byRoleThenName);
    return members.map((m) =>
      viewer.role === "vert"
        ? { userId: m.userId, name: m.name, role: m.role, joinedAt: m.joinedAt, ...(m.area ? { area: m.area } : {}) }
        : { userId: m.userId, name: m.name, role: m.role }
    );
  }

  // ---------- Applications ----------

  async apply(villageId: string, user: User, input: unknown): Promise<Application> {
    const village = await this.village(villageId);
    if (await this.store.getMember(villageId, user.id)) throw new ApiError(409, "Du er allerede med i landsbyen.");
    const waiting = (await this.store.applicationsOf(user.id)).find((a) => a.villageId === villageId && a.status === "venter");
    if (waiting) throw new ApiError(409, "Søknaden din venter allerede på en landsbyvert.");
    const read = readApplication(input);
    if (!read.ok) throw new ApiError(400, read.error);
    const application: Application = {
      id: this.newId("soknad"),
      villageId: village.id,
      userId: user.id,
      ...read.value,
      status: "venter",
      appliedAt: this.nowIso(),
    };
    await this.store.putApplication(application);
    return application;
  }

  /** A host sees the waiting ones; anyone else sees their own. Oldest first. */
  async applications(villageId: string, user: User): Promise<Application[]> {
    const village = await this.village(villageId);
    const member = await this.store.getMember(village.id, user.id);
    const all = await this.store.listApplications(villageId);
    const shown = member?.role === "vert" ? all.filter((a) => a.status === "venter") : all.filter((a) => a.userId === user.id);
    return shown.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
  }

  private async waitingApplication(village: Village, applicationId: string): Promise<Application> {
    const application = await this.store.getApplication(village.id, applicationId);
    if (!application) throw notFound("søknaden");
    if (application.status !== "venter") throw new ApiError(409, "Søknaden er allerede behandlet.");
    return application;
  }

  async approve(villageId: string, applicationId: string, user: User, input: unknown) {
    const village = await this.village(villageId);
    await this.host(village, user);
    const application = await this.waitingApplication(village, applicationId);
    const decision = readApproval(input);
    if (!decision.ok) throw new ApiError(400, decision.error);
    const at = this.nowIso();
    const member: Member = {
      villageId,
      userId: application.userId,
      name: application.name,
      role: decision.value.role,
      joinedAt: at,
      ...(application.area ? { area: application.area } : {}),
    };
    await this.store.putMember(member);
    await this.store.putApplication({
      ...application,
      status: "godkjent",
      decidedAt: at,
      decidedBy: user.id,
      ...(decision.value.welcome ? { welcome: decision.value.welcome } : {}),
    });
    return { userId: member.userId, name: member.name, role: member.role, joinedAt: member.joinedAt };
  }

  async reject(villageId: string, applicationId: string, user: User, input: unknown): Promise<Application> {
    const village = await this.village(villageId);
    await this.host(village, user);
    const application = await this.waitingApplication(village, applicationId);
    const reason = typeof (input as { reason?: unknown } | null)?.reason === "string" ? (input as { reason: string }).reason.trim().slice(0, 500) : "";
    const decided: Application = {
      ...application,
      status: "avslatt",
      decidedAt: this.nowIso(),
      decidedBy: user.id,
      ...(reason ? { reason } : {}),
    };
    await this.store.putApplication(decided);
    return decided;
  }

  // ---------- Torget ----------

  async posts(villageId: string, user: User, query: { kind?: string | null; category?: string | null; tag?: string | null }): Promise<PostView[]> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const filter: PostFilter = {};
    if (query.kind) {
      if (!POST_KINDS.includes(query.kind as PostKind)) throw new ApiError(400, "Ukjent type innlegg.");
      filter.kind = query.kind as PostKind;
    }
    if (query.category) {
      if (!INVITATION_CATEGORIES.includes(query.category as InvitationCategory)) throw new ApiError(400, "Ukjent kategori.");
      filter.category = query.category as InvitationCategory;
    }
    if (query.tag) filter.tag = query.tag.toLocaleLowerCase("nb").replace(/^#/, "");
    const [posts, responses] = await Promise.all([this.store.listPosts(villageId), this.store.listResponses(villageId)]);
    return torget(posts, filter, viewer, this.today(village)).map((post) => this.postView(post, responses, viewer));
  }

  async tags(villageId: string, user: User): Promise<string[]> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    return tagsInUse(torget(await this.store.listPosts(villageId), {}, viewer, this.today(village)));
  }

  async createPost(villageId: string, user: User, input: unknown): Promise<PostView> {
    const village = await this.village(villageId);
    const author = await this.member(village, user);
    const read = readNewPost(input, this.today(village), (moment) => dayIn(village.timeZone, moment));
    if (!read.ok) throw new ApiError(400, read.error);
    const post: Post = {
      id: this.newId("innlegg"),
      villageId,
      ...read.value,
      authorId: author.userId,
      authorName: author.name,
      createdAt: this.nowIso(),
    };
    await this.store.putPost(post);
    return this.postView(post, [], author);
  }

  /** The post, when the viewer may see it. A discreet post is «not found» for everyone else. */
  private async visiblePost(village: Village, postId: string, viewer: Member): Promise<Post> {
    const post = await this.store.getPost(village.id, postId);
    if (!post || !maySeePost(post, viewer.userId, viewer.role)) throw notFound("innlegget");
    return post;
  }

  async post(villageId: string, postId: string, user: User): Promise<PostView> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const post = await this.visiblePost(village, postId, viewer);
    return this.postView(post, await this.store.listResponses(villageId, postId), viewer);
  }

  async closePost(villageId: string, postId: string, user: User): Promise<PostView> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const post = await this.visiblePost(village, postId, viewer);
    if (!mayManagePost(post, viewer.userId, viewer.role)) throw forbidden("Bare den som la ut innlegget, eller en landsbyvert, kan avslutte det.");
    const closed: Post = { ...post, closedAt: post.closedAt ?? this.nowIso() };
    await this.store.putPost(closed);
    return this.postView(closed, await this.store.listResponses(villageId, postId), viewer);
  }

  async deletePost(villageId: string, postId: string, user: User): Promise<void> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const post = await this.visiblePost(village, postId, viewer);
    if (!mayManagePost(post, viewer.userId, viewer.role)) throw forbidden("Bare den som la ut innlegget, eller en landsbyvert, kan slette det.");
    await this.store.deletePost(villageId, postId);
  }

  async answer(villageId: string, postId: string, user: User): Promise<PostView> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const post = await this.visiblePost(village, postId, viewer);
    const refusal = answerRefusal(post, viewer.userId, this.today(village));
    if (refusal) throw new ApiError(409, refusal);
    const existing = (await this.store.listResponses(villageId, postId)).find((r) => r.userId === viewer.userId);
    if (!existing) {
      await this.store.putResponse({
        villageId,
        postId,
        userId: viewer.userId,
        name: viewer.name,
        answer: KIND_INFO[post.kind].answer!,
        at: this.nowIso(),
      });
    }
    return this.postView(post, await this.store.listResponses(villageId, postId), viewer);
  }

  async withdraw(villageId: string, postId: string, user: User): Promise<PostView> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const post = await this.visiblePost(village, postId, viewer);
    await this.store.deleteResponse(villageId, postId, viewer.userId);
    return this.postView(post, await this.store.listResponses(villageId, postId), viewer);
  }

  // ---------- Private messages ----------

  async messages(villageId: string, postId: string, user: User, withId: string | null): Promise<Message[]> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const post = await this.visiblePost(village, postId, viewer);
    if (!withId) throw new ApiError(400, "Si hvem samtalen er med.");
    const responses = await this.store.listResponses(villageId, postId);
    const messages = await this.store.listMessages(villageId, postId);
    const talk = conversation(messages, postId, viewer.userId, withId);
    // A conversation stays readable after an answer is withdrawn; a new one cannot be started
    if (talk.length === 0 && !mayMessage(post, viewer.userId, withId, responses)) {
      throw forbidden("Private meldinger går mellom den som la ut innlegget og dem som har svart.");
    }
    return talk;
  }

  async sendMessage(villageId: string, postId: string, user: User, input: unknown): Promise<Message> {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const post = await this.visiblePost(village, postId, viewer);
    const to = (input as { to?: unknown } | null)?.to;
    if (typeof to !== "string" || !to) throw new ApiError(400, "Si hvem meldingen skal til.");
    const text = readMessageText((input as { text?: unknown }).text);
    if (!text.ok) throw new ApiError(400, text.error);
    if (!mayMessage(post, viewer.userId, to, await this.store.listResponses(villageId, postId))) {
      throw forbidden("Private meldinger går mellom den som la ut innlegget og dem som har svart.");
    }
    const message: Message = {
      id: this.newId("melding"),
      villageId,
      postId,
      fromId: viewer.userId,
      fromName: viewer.name,
      toId: to,
      text: text.value,
      at: this.nowIso(),
    };
    await this.store.putMessage(message);
    return message;
  }

  /** The conversations the user is in, newest first, with the other person and the last word. */
  async conversations(villageId: string, user: User) {
    const village = await this.village(villageId);
    const viewer = await this.member(village, user);
    const [messages, posts, members] = await Promise.all([
      this.store.listMessages(villageId),
      this.store.listPosts(villageId),
      this.store.listMembers(villageId),
    ]);
    const latest = new Map<string, Message>();
    for (const message of messages) {
      if (message.fromId !== viewer.userId && message.toId !== viewer.userId) continue;
      const other = message.fromId === viewer.userId ? message.toId : message.fromId;
      const key = `${message.postId}|${other}`;
      const seen = latest.get(key);
      if (!seen || seen.at < message.at) latest.set(key, message);
    }
    return [...latest.entries()]
      .map(([key, last]) => {
        const [postId, withId] = key.split("|");
        return {
          postId,
          postTitle: posts.find((p) => p.id === postId)?.title ?? "Slettet innlegg",
          withId,
          withName: members.find((m) => m.userId === withId)?.name ?? (last.fromId === withId ? last.fromName : "Ukjent"),
          lastText: last.text,
          lastAt: last.at,
        };
      })
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }
}
