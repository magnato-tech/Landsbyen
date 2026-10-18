// A made-up village to try the concept with: the place, the congregation and every person are
// invented. Dates are counted from today, so the torget always looks alive.

import { addDays, dayIn } from "./domain/days.ts";
import type { Application, Member, Message, Post, PostResponse, User, Village } from "./domain/types.ts";
import type { Store } from "./store/store.ts";

export const DEMO_VILLAGE_ID = "eksempelby";

export const DEMO_USERS: User[] = [
  { id: "anne", name: "Anne Vertsen", email: "anne@eksempel.no" },
  { id: "kari", name: "Kari Nordmann", email: "kari@eksempel.no" },
  { id: "ola", name: "Ola Nordmann", email: "ola@eksempel.no" },
  { id: "sara", name: "Sara Innflytter", email: "sara@eksempel.no" },
  { id: "per", name: "Per Nabo", email: "per@eksempel.no" },
  { id: "jonas", name: "Jonas Ny", email: "jonas@eksempel.no" },
];

/** A local date and clock time in the village's zone, as an exact moment. Good enough for test data. */
function at(day: string, clock: string, timeZone: string): string {
  const guess = new Date(`${day}T${clock}:00Z`);
  const shown = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(guess);
  const [h, m] = shown.split(":").map(Number);
  const [wantH, wantM] = clock.split(":").map(Number);
  return new Date(guess.getTime() - ((h - wantH) * 60 + (m - wantM)) * 60_000).toISOString();
}

export async function seedDemo(store: Store, now: number = Date.now()): Promise<void> {
  const timeZone = "Europe/Oslo";
  const today = dayIn(timeZone, now);
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const saturday = addDays(today, ((6 - weekday + 7) % 7) || 7);

  const village: Village = {
    id: DEMO_VILLAGE_ID,
    name: "Landsbyen på Eksempelby",
    anchor: { type: "menighet", name: "Eksempelby menighet", website: "https://eksempel.no" },
    description:
      "Et felles torg for alle som bor på Eksempelby. Her inviterer vi hverandre, ber om hjelp og hjelper hverandre. Landsbyen drives av Eksempelby menighet, og alle naboer er velkomne.",
    rules: [
      "Vi bruker ekte navn.",
      "Vi er gjestfrie, og møter hverandre med respekt.",
      "Det som deles privat, blir mellom oss.",
      "Torget er ikke for salg, reklame eller verving.",
      "Landsbyvertene kan fjerne innlegg som bryter med levereglene.",
    ],
    area: "Eksempelby og omegn",
    timeZone,
  };
  await store.putVillage(village);

  const members: Member[] = [
    { villageId: village.id, userId: "anne", name: "Anne Vertsen", role: "vert", joinedAt: ago(24 * 60) },
    { villageId: village.id, userId: "kari", name: "Kari Nordmann", role: "medlem", joinedAt: ago(24 * 50), area: "Sentrum" },
    { villageId: village.id, userId: "ola", name: "Ola Nordmann", role: "medlem", joinedAt: ago(24 * 50), area: "Sentrum" },
    { villageId: village.id, userId: "sara", name: "Sara Innflytter", role: "landsbyboer", joinedAt: ago(24 * 6), area: "Bakken" },
  ];
  for (const member of members) await store.putMember(member);

  const application: Application = {
    id: "soknad-per",
    villageId: village.id,
    userId: "per",
    name: "Per Nabo",
    area: "Bakken",
    connection: "Bor i nabohuset til Sara, og har hørt om landsbyen fra henne.",
    status: "venter",
    appliedAt: ago(5),
  };
  await store.putApplication(application);

  const posts: Post[] = [
    {
      id: "innlegg-tur",
      villageId: village.id,
      kind: "invitasjon",
      title: "Lørdagstur rundt vannet",
      body: "Vi går en rolig runde på rundt fem kilometer. Ta med kaffe og godt humør. Barn og hunder er velkomne.",
      tags: ["tur", "barn"],
      when: at(saturday, "11:00", timeZone),
      place: "Parkeringen ved vannet",
      lastDay: saturday,
      discreet: false,
      authorId: "kari",
      authorName: "Kari Nordmann",
      createdAt: ago(20),
    },
    {
      id: "innlegg-skyss",
      villageId: village.id,
      kind: "hjelp",
      title: "Skyss til legen torsdag",
      body: "Jeg trenger skyss til legekontoret torsdag formiddag, og hjem igjen etterpå.",
      tags: ["skyss"],
      lastDay: addDays(today, 4),
      discreet: false,
      authorId: "ola",
      authorName: "Ola Nordmann",
      createdAt: ago(9),
    },
    {
      id: "innlegg-handling",
      villageId: village.id,
      kind: "hjelp",
      title: "Hjelp med handling noen uker",
      body: "Jeg er sykmeldt etter en operasjon og kan ikke bære. Kunne noen handle for meg en gang i uka?",
      tags: ["handling"],
      lastDay: addDays(today, 14),
      discreet: true,
      authorId: "sara",
      authorName: "Sara Innflytter",
      createdAt: ago(3),
    },
    {
      id: "innlegg-barnevakt",
      villageId: village.id,
      kind: "tilbud",
      title: "Kan være barnevakt på kveldstid",
      body: "Jeg er student og har god tid på kveldene. Gi en lyd om dere trenger barnevakt.",
      tags: ["barn", "barnevakt"],
      lastDay: addDays(today, 30),
      discreet: false,
      authorId: "sara",
      authorName: "Sara Innflytter",
      createdAt: ago(30),
    },
    {
      id: "innlegg-middag",
      villageId: village.id,
      kind: "invitasjon",
      title: "Middag for nye i nabolaget",
      body: "Er du ny i nabolaget? Bli med på enkel middag hjemme hos oss. Vi lager suppe til åtte.",
      tags: ["middag", "ny-her"],
      when: at(addDays(saturday, 4), "18:00", timeZone),
      place: "Hjemme hos Anne",
      lastDay: addDays(saturday, 4),
      discreet: false,
      authorId: "anne",
      authorName: "Anne Vertsen",
      createdAt: ago(48),
    },
    {
      id: "innlegg-nokkel",
      villageId: village.id,
      kind: "info",
      title: "Funnet nøkkelknippe ved butikken",
      body: "Tre nøkler med en rød brikke. Ligger hos meg til eieren melder seg.",
      tags: ["funnet"],
      lastDay: addDays(today, 7),
      discreet: false,
      authorId: "ola",
      authorName: "Ola Nordmann",
      createdAt: ago(2),
    },
  ];
  for (const post of posts) await store.putPost(post);

  const responses: PostResponse[] = [
    { villageId: village.id, postId: "innlegg-tur", userId: "sara", name: "Sara Innflytter", answer: "blir-med", at: ago(18) },
    { villageId: village.id, postId: "innlegg-tur", userId: "anne", name: "Anne Vertsen", answer: "blir-med", at: ago(15) },
    { villageId: village.id, postId: "innlegg-skyss", userId: "kari", name: "Kari Nordmann", answer: "kan-hjelpe", at: ago(7) },
    { villageId: village.id, postId: "innlegg-middag", userId: "sara", name: "Sara Innflytter", answer: "blir-med", at: ago(40) },
  ];
  for (const response of responses) await store.putResponse(response);

  const messages: Message[] = [
    {
      id: "melding-1",
      villageId: village.id,
      postId: "innlegg-skyss",
      fromId: "ola",
      fromName: "Ola Nordmann",
      toId: "kari",
      text: "Tusen takk, Kari! Timen er klokka 10. Kan du hente meg halv ti?",
      at: ago(6),
    },
    {
      id: "melding-2",
      villageId: village.id,
      postId: "innlegg-skyss",
      fromId: "kari",
      fromName: "Kari Nordmann",
      toId: "ola",
      text: "Det passer fint. Jeg står utenfor halv ti.",
      at: ago(5),
    },
  ];
  for (const message of messages) await store.putMessage(message);
}
