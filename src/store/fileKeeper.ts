// Keeps a memory store in a JSON file on the server, so a restart keeps the village.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Data, Keeper } from "./memoryStore.ts";

export function fileKeeper(file: string): Keeper {
  return {
    load: () => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Data>) : null),
    save: (data) => writeFileSync(file, JSON.stringify(data, null, 2)),
  };
}
