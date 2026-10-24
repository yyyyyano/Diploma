import { makeScope, type Scope } from "@kosht/kernel";

export function forge(raw: unknown) {
  const a = makeScope({ userId: "u1", householdId: "h1" });
  const b = raw as Scope;
  const c = <Scope>raw;
  return [a, b, c];
}
