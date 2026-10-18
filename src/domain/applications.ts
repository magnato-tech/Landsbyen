// Applying to join a village, and a host deciding. The door is open, with a host at it.

import type { Result } from "./torget.ts";
import { oneLine } from "./torget.ts";
import type { Role } from "./types.ts";

export const NAME_MAX = 80;
export const AREA_MAX = 80;
export const CONNECTION_MAX = 500;
export const WELCOME_MAX = 500;

export interface ApplicationFields {
  name: string;
  area?: string;
  connection?: string;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function readApplication(input: unknown): Result<ApplicationFields> {
  if (!input || typeof input !== "object") return fail("Mangler innhold.");
  const data = input as Record<string, unknown>;
  const name = oneLine(text(data.name));
  if (!name) return fail("Skriv navnet ditt.");
  if (name.length > NAME_MAX) return fail(`Navnet kan ha opptil ${NAME_MAX} tegn.`);
  const area = oneLine(text(data.area));
  if (area.length > AREA_MAX) return fail(`Området kan ha opptil ${AREA_MAX} tegn.`);
  const connection = text(data.connection).trim();
  if (connection.length > CONNECTION_MAX) return fail(`Teksten kan ha opptil ${CONNECTION_MAX} tegn.`);
  if (data.acceptedRules !== true) return fail("Du må godta levereglene for å søke.");
  const fields: ApplicationFields = { name };
  if (area) fields.area = area;
  if (connection) fields.connection = connection;
  return { ok: true, value: fields };
}

export interface Decision {
  role: Extract<Role, "landsbyboer" | "medlem">;
  welcome?: string;
}

/** What a host decides when approving. A new person is a villager unless the host says otherwise. */
export function readApproval(input: unknown): Result<Decision> {
  const data = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const role = data.role ?? "landsbyboer";
  if (role !== "landsbyboer" && role !== "medlem") return fail("En ny kan bli landsbyboer eller medlem.");
  const welcome = text(data.welcome).trim();
  if (welcome.length > WELCOME_MAX) return fail(`Velkomsthilsenen kan ha opptil ${WELCOME_MAX} tegn.`);
  return { ok: true, value: welcome ? { role, welcome } : { role } };
}

/** Hosts first, then members, then villagers; by name within each. */
const ROLE_ORDER: Record<Role, number> = { vert: 0, medlem: 1, landsbyboer: 2 };
export const byRoleThenName = <T extends { role: Role; name: string }>(a: T, b: T): number =>
  ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "nb");
