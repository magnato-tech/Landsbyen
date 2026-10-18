// The living roofline: what happens in the village the coming week, as symbols standing over the
// roofs in the band at the top. Pure, so it can be tested: which posts get a symbol, and over
// which roof each one stands.

import { addDays } from "../src/domain/days.ts";
import type { InvitationCategory, PostKind } from "../src/domain/types.ts";

/** What the roofline needs to know of a post. A preview for someone outside has no id. */
export interface RoofPost {
  id?: string;
  kind: PostKind;
  category?: InvitationCategory;
  title: string;
  when?: string;
  discreet?: boolean;
  createdAt?: string;
}

export interface Landmark extends RoofPost {
  /** Where the symbol stands, in the roofline's own units (viewBox 0 0 360 64). */
  x: number;
  y: number;
}

/** The top of each roof, and of the church's spire. */
export const ROOFTOPS = {
  houses: [
    { x: 26, y: 20 },
    { x: 68, y: 29 },
    { x: 114, y: 11 },
    { x: 220, y: 26 },
    { x: 266, y: 15 },
    { x: 309, y: 32 },
    { x: 342, y: 27 },
  ],
  church: { x: 172, y: 2 },
};

// Filled from the middle out, so a quiet week still looks like the heart of the village
const HOUSE_ORDER = [2, 3, 4, 1, 5, 0, 6];

export const ROOF_MAX = 8;
export const ROOF_DAYS = 7;

/**
 * The posts that get a symbol, at most eight: invitations happening within the coming week,
 * soonest first; then open requests for help and offers, newest first. A discreet request
 * never stands over a roof.
 */
export function roofPosts(posts: readonly RoofPost[], today: string, dayOf: (moment: string) => string): RoofPost[] {
  const until = addDays(today, ROOF_DAYS - 1);
  const coming = posts
    .filter((p) => p.kind === "invitasjon" && p.when && dayOf(p.when) >= today && dayOf(p.when) <= until)
    .sort((a, b) => a.when!.localeCompare(b.when!));
  const newest = (a: RoofPost, b: RoofPost) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  const help = posts.filter((p) => p.kind === "hjelp" && !p.discreet).sort(newest);
  const offers = posts.filter((p) => p.kind === "tilbud").sort(newest);
  return [...coming, ...help, ...offers].slice(0, ROOF_MAX);
}

/**
 * Where each symbol stands. A gathering goes over the church when it is free; everything else
 * takes the houses from the middle out, and the church last.
 */
export function placeOnRoofs(posts: readonly RoofPost[]): Landmark[] {
  const free = HOUSE_ORDER.map((i) => ROOFTOPS.houses[i]);
  let church: { x: number; y: number } | null = ROOFTOPS.church;
  const placed: Landmark[] = [];
  for (const post of posts) {
    let spot: { x: number; y: number } | undefined;
    if (post.category === "samling" && church) {
      spot = church;
      church = null;
    } else {
      spot = free.shift();
      if (!spot && church) {
        spot = church;
        church = null;
      }
    }
    if (!spot) break;
    placed.push({ ...post, ...spot });
  }
  return placed;
}
