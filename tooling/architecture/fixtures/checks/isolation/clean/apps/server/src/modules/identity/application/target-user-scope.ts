import { makeScope } from "@kosht/kernel";

export function targetUserScope(ids: { userId: string; householdId: string }) {
  return makeScope(ids);
}
