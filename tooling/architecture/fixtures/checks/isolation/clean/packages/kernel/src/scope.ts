declare const brand: unique symbol;
export type Scope = { readonly userId: string; readonly householdId: string; readonly [brand]: true };

export function makeScope(input: { userId: string; householdId: string }): Scope {
  return input as Scope;
}
