// The things a village is made of, as they are stored. Every store (memory, Firestore) holds
// exactly these shapes; what the API sends out is built from them in http/views.ts.

export const ROLES = ["vert", "medlem", "landsbyboer"] as const;
export type Role = (typeof ROLES)[number];

export const ANCHOR_TYPES = ["menighet", "nabolag", "borettslag", "annet"] as const;
export type AnchorType = (typeof ANCHOR_TYPES)[number];

/** Who runs the village. Shown wherever the village is presented, so nobody is surprised later. */
export interface Anchor {
  type: AnchorType;
  name: string;
  website?: string;
  /** A link to another system, e.g. the congregation's Menighetsplan. */
  externalRef?: string;
}

export interface Village {
  id: string;
  name: string;
  anchor: Anchor;
  description: string;
  /** The rules everyone accepts when they apply. */
  rules: string[];
  area?: string;
  /** Calendar days (a post's last day) are counted here. */
  timeZone: string;
}

/** Someone signed in, as the sign-in tells it. Not the same as being in a village. */
export interface User {
  id: string;
  name: string;
  email?: string;
}

export interface Member {
  villageId: string;
  userId: string;
  name: string;
  role: Role;
  joinedAt: string;
  area?: string;
}

export const APPLICATION_STATUSES = ["venter", "godkjent", "avslatt"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface Application {
  id: string;
  villageId: string;
  userId: string;
  name: string;
  area?: string;
  connection?: string;
  status: ApplicationStatus;
  appliedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  welcome?: string;
  reason?: string;
}

export const POST_KINDS = ["invitasjon", "hjelp", "tilbud", "info"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const ANSWERS = ["blir-med", "kan-hjelpe", "onsker"] as const;
export type Answer = (typeof ANSWERS)[number];

export interface Post {
  id: string;
  villageId: string;
  kind: PostKind;
  title: string;
  body: string;
  /** Lower case, without «#», at most five. */
  tags: string[];
  /** When an invitation happens: an exact moment with its zone. */
  when?: string;
  place?: string;
  /** The last calendar day the post is on the torget. */
  lastDay: string;
  /** A request for help only the asker and the hosts see. Never on other kinds. */
  discreet: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
  closedAt?: string;
}

export interface PostResponse {
  villageId: string;
  postId: string;
  userId: string;
  name: string;
  answer: Answer;
  at: string;
}

export interface Message {
  id: string;
  villageId: string;
  postId: string;
  fromId: string;
  fromName: string;
  toId: string;
  text: string;
  at: string;
}
