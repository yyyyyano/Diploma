// Запросы к журналу согласий (privacy_consents) — только через ScopedDb владельца: s.own на каждый запрос.
import { and, desc, eq } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { privacyConsents, type ConsentKind } from "./schema.ts";

export interface ConsentDecision {
  readonly kind: ConsentKind;
  readonly granted: boolean;
  readonly textVersion: string;
}

/** Записать решения; момент — `at` (часы платформы). Возвращает id новых строк. */
export async function insertConsents(
  s: ScopedDb,
  decisions: readonly ConsentDecision[],
  at: Date,
): Promise<string[]> {
  const rows = await s
    .insert(privacyConsents)
    .values(decisions.map((d) => ({ ...d, createdAt: at, updatedAt: at })))
    .returning({ id: privacyConsents.id });
  return rows.map((row) => row.id);
}

/** Последнее решение пользователя scope по виду согласия; решений не было — undefined. */
export async function latestConsent(
  s: ScopedDb,
  kind: ConsentKind,
): Promise<{ granted: boolean; textVersion: string; at: Date } | undefined> {
  const rows = await s.db
    .select({
      granted: privacyConsents.granted,
      textVersion: privacyConsents.textVersion,
      at: privacyConsents.createdAt,
    })
    .from(privacyConsents)
    .where(
      and(
        s.own(privacyConsents),
        eq(privacyConsents.userId, s.scope.userId),
        eq(privacyConsents.kind, kind),
      ),
    )
    .orderBy(desc(privacyConsents.createdAt), desc(privacyConsents.id))
    .limit(1);
  return rows[0];
}
