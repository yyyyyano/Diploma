import { makeScope } from "@kosht/kernel";

export function scopeFromSession(session: { userId: string; householdId: string }) {
  return makeScope({ userId: session.userId, householdId: session.householdId });
}
