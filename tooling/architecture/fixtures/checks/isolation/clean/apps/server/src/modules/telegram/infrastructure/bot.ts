import { makeScope } from "@kosht/kernel";

export function scopeForChat(link: { userId: string; householdId: string }) {
  return makeScope(link);
}
