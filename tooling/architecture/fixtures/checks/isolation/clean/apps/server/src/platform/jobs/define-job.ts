import { makeScope } from "@kosht/kernel";

export interface JobEnvelope<P> { scope: { userId: string; householdId: string }; requestId: string; payload: P }

export function defineJob<P>(def: JobDef<P>) {
  return def;
}

export function scopeFromEnvelope(envelope: JobEnvelope<unknown>) {
  return makeScope(envelope.scope);
}
