import { makeScope } from "@kosht/kernel";

export const signUpScope = (raw: { userId: string; householdId: string }) => makeScope(raw);
