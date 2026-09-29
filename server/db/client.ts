import { createGetDb } from "@agent-native/core/db";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);

/** Transactiehandgreep van `getDb().transaction(...)`, voor writes die uit meerdere stappen bestaan. */
export type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
