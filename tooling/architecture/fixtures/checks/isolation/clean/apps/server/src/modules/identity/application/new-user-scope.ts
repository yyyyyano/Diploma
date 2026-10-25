import { makeScope } from "@kosht/kernel";

export function newUserScope(ids: { userId: string; householdId: string }) {
  return makeScope(ids);
}
