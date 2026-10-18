// Torget: the one shared room of the village. Everything here is pure – what a post may hold,
// who sees it, what answering means and who may write to whom – so the API, the tests and a
// later client (or Menighetsplan) all ask the same questions and get the same answers.

import { POST_KINDS, type Answer, type Message, type Post, type PostKind, type PostResponse, type Role } from "./types.ts";
import { addDays, isIsoDay } from "./days.ts";

export interface KindInfo {
  label: string;
  /** The button on someone else's post, or null when the post takes no answer. */
  action: string | null;
  answer: Answer | null;
  /** «Kari og Ola blir med». */
  answeredAs: (names: string) => string;
}

export const KIND_INFO: Record<PostKind, KindInfo> = {
  invitasjon: { label: "Invitasjon", action: "Bli med", answer: "blir-med", answeredAs: (n) => `${n} blir med` },
  hjelp: { label: "Be om hjelp", action: "Jeg kan hjelpe", answer: "kan-hjelpe", answeredAs: (n) => `${n} kan hjelpe` },
  tilbud: { label: "Tilbyr hjelp", action: "Ja takk", answer: "onsker", answeredAs: (n) => `${n} vil gjerne` },
  info: { label: "Til info", action: null, answer: null, answeredAs: (n) => n },
};

export const TITLE_MAX = 80;
export const BODY_MAX = 600;
export const PLACE_MAX = 80;
export const TAGS_MAX = 5;
export const TAG_MAX = 24;
export const MESSAGE_MAX = 500;
/** How long a post stands when nobody says otherwise. */
export const DEFAULT_DAYS = 14;
/** The furthest ahead a post may stand. */
export const MAX_DAYS = 90;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** One line, no spaces at the ends, no runs of spaces. */
export const oneLine = (value: string): string => value.trim().replace(/\s+/g, " ");

/** Lower case, without «#», letters, digits and «-» only, no repeats, at most five. */
export function cleanTags(values: readonly unknown[]): string[] {
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const raw of value.split(/[\s,#]+/)) {
      const tag = raw.toLocaleLowerCase("nb").replace(/[^\p{L}\p{N}-]/gu, "").slice(0, TAG_MAX);
      if (tag && !tags.includes(tag)) tags.push(tag);
      if (tags.length === TAGS_MAX) return tags;
    }
  }
  return tags;
}

export type PostFields = Pick<Post, "kind" | "title" | "body" | "tags" | "when" | "place" | "lastDay" | "discreet">;

const isString = (value: unknown): value is string => typeof value === "string";

/**
 * The post a request becomes, or what is wrong with it. An invitation stands until the day it
 * happens unless another last day is given; anything else stands for two weeks.
 *
 * `today` is the calendar day in the village's time zone, and `dayOf` turns a moment into one.
 */
export function readNewPost(input: unknown, today: string, dayOf: (moment: string) => string): Result<PostFields> {
  if (!input || typeof input !== "object") return fail("Mangler innhold.");
  const data = input as Record<string, unknown>;

  const kind = data.kind;
  if (!POST_KINDS.includes(kind as PostKind)) return fail("Velg hva innlegget gjelder: invitasjon, hjelp, tilbud eller info.");
  const title = isString(data.title) ? oneLine(data.title) : "";
  if (!title) return fail("Skriv en overskrift.");
  if (title.length > TITLE_MAX) return fail(`Overskriften kan ha opptil ${TITLE_MAX} tegn.`);
  const body = isString(data.body) ? data.body.trim() : "";
  if (body.length > BODY_MAX) return fail(`Teksten kan ha opptil ${BODY_MAX} tegn.`);
  const place = isString(data.place) ? oneLine(data.place) : "";
  if (place.length > PLACE_MAX) return fail(`Stedet kan ha opptil ${PLACE_MAX} tegn.`);
  if (data.tags !== undefined && !Array.isArray(data.tags)) return fail("Taggene må være en liste.");

  let when: string | undefined;
  if (data.when !== undefined && data.when !== null && data.when !== "") {
    // An exact moment with its zone, so the phone and the server read the same time
    if (!isString(data.when) || !/(Z|[+-]\d{2}:\d{2})$/.test(data.when) || Number.isNaN(Date.parse(data.when))) {
      return fail("Tidspunktet må være et tidspunkt med tidssone.");
    }
    when = new Date(data.when).toISOString();
    if (dayOf(when) < today) return fail("Tidspunktet har vært.");
  }

  const latest = addDays(today, MAX_DAYS);
  const lastDay = isString(data.lastDay) && data.lastDay ? data.lastDay : when ? dayOf(when) : addDays(today, DEFAULT_DAYS);
  if (!isIsoDay(lastDay)) return fail("Siste dag er ikke en gyldig dato.");
  if (lastDay < today) return fail("Siste dag har vært.");
  if (lastDay > latest) return fail(`Et innlegg kan stå i opptil ${MAX_DAYS} dager.`);

  if (data.discreet === true && kind !== "hjelp") return fail("Bare en forespørsel om hjelp kan være diskret.");

  const fields: PostFields = {
    kind: kind as PostKind,
    title,
    body,
    tags: cleanTags((data.tags as unknown[] | undefined) ?? []),
    lastDay,
    discreet: kind === "hjelp" && data.discreet === true,
  };
  if (when) fields.when = when;
  if (place) fields.place = place;
  return { ok: true, value: fields };
}

/** Whether a post is on the torget today: not closed, and its last day has not passed. */
export const isOnTorget = (post: Pick<Post, "closedAt" | "lastDay">, today: string): boolean =>
  !post.closedAt && post.lastDay >= today;

/** Whether someone in the village may see the post. */
export const maySeePost = (post: Pick<Post, "discreet" | "authorId">, userId: string, role: Role): boolean =>
  !post.discreet || post.authorId === userId || role === "vert";

/** Whether someone may close or delete the post: the one who wrote it, or a host. */
export const mayManagePost = (post: Pick<Post, "authorId">, userId: string, role: Role): boolean =>
  post.authorId === userId || role === "vert";

export interface PostFilter {
  kind?: PostKind;
  tag?: string;
}

const newestFirst = (a: Post, b: Post) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** The posts on the torget for one person, newest first. */
export function torget(posts: readonly Post[], filter: PostFilter, viewer: { userId: string; role: Role }, today: string): Post[] {
  return posts
    .filter((post) => isOnTorget(post, today))
    .filter((post) => maySeePost(post, viewer.userId, viewer.role))
    .filter((post) => !filter.kind || post.kind === filter.kind)
    .filter((post) => !filter.tag || post.tags.includes(filter.tag))
    .sort(newestFirst);
}

/** The tags used on the posts given, most used first, then by name. */
export function tagsInUse(posts: readonly Post[]): string[] {
  const counts = new Map<string, number>();
  for (const post of posts) for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b, "nb")).map(([tag]) => tag);
}

/** Why someone may not answer the post, or null when they may. The answer follows from its kind. */
export function answerRefusal(post: Post, userId: string, today: string): string | null {
  if (!isOnTorget(post, today)) return "Innlegget er ikke lenger på torget.";
  if (post.authorId === userId) return "Du kan ikke svare på ditt eget innlegg.";
  if (post.discreet) return "En diskret forespørsel følges opp av landsbyvertene.";
  if (!KIND_INFO[post.kind].answer) return "Dette innlegget tar ikke svar.";
  return null;
}

const firstCome = (a: PostResponse, b: PostResponse) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

export const responsesTo = (responses: readonly PostResponse[], postId: string): PostResponse[] =>
  responses.filter((response) => response.postId === postId).sort(firstCome);

/** «Kari», «Kari og Ola», «Kari, Ola og Per». */
export function namesInProse(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
}

/** What a post says about its answers, or null when nobody has answered. */
export function answersLine(kind: PostKind, responses: readonly PostResponse[]): string | null {
  if (responses.length === 0) return null;
  return KIND_INFO[kind].answeredAs(namesInProse(responses.map((response) => response.name)));
}

/**
 * Whether one person may write privately to another about a post: the asker to someone who
 * answered, and someone who answered to the asker. Nobody else, so the torget never becomes a
 * place to be contacted by strangers.
 */
export function mayMessage(post: Pick<Post, "id" | "authorId">, fromId: string, toId: string, responses: readonly PostResponse[]): boolean {
  if (fromId === toId) return false;
  const answered = (userId: string) => responses.some((r) => r.postId === post.id && r.userId === userId);
  return (post.authorId === fromId && answered(toId)) || (post.authorId === toId && answered(fromId));
}

/** The message as stored: no spaces at the ends. An error when empty or too long. */
export function readMessageText(value: unknown): Result<string> {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fail("Skriv en melding.");
  if (text.length > MESSAGE_MAX) return fail(`En melding kan ha opptil ${MESSAGE_MAX} tegn.`);
  return { ok: true, value: text };
}

/** The private messages between two people about one post, oldest first. */
export const conversation = (messages: readonly Message[], postId: string, a: string, b: string): Message[] =>
  messages
    .filter((m) => m.postId === postId && ((m.fromId === a && m.toId === b) || (m.fromId === b && m.toId === a)))
    .sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
