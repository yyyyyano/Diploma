import { makeScope } from "@kosht/kernel";

export const channelScope = (raw: { userId: string; householdId: string }) => makeScope(raw);
