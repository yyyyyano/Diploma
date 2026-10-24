import { makeScope } from "@kosht/kernel";

export const linkScope = (raw: { userId: string; householdId: string }) => makeScope(raw);
