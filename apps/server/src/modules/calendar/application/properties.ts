// Имущество в профиле (PROF-07): анкета о нём не спрашивает. Система выводит факт из операций — расходы на топливо (категория «Авто»),
// платёж страховщику, уплата налога на недвижимость или земельного — как «предположение» и один раз спрашивает в календаре
// («У вас есть автомобиль? Тогда я напомню о транспортном налоге и ОСАГО»). Ответ — факт «подтверждён» с «Отменить»; «нет» тоже факт,
// поэтому тот же вопрос второй раз не задаётся. Нет ни предположений, ни фактов об имуществе — один вопрос про автомобиль при первом
// открытии календаря. События налогов появляются только по подтверждённому факту (`deadlines.ts`).
import type { PropertyKind, PropertyQuestion } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { EVIDENCE_DAYS, EVIDENCE_WORDS } from "../settings.ts";
import type { Deps } from "./deps.ts";

const KINDS = ["car", "apartment", "land"] as const satisfies readonly PropertyKind[];
const FACT_KEY = {
  car: "property.car",
  apartment: "property.apartment",
  land: "property.land",
} as const;
type Evidence = NonNullable<PropertyQuestion["evidence"]>;
const SOURCE_PREFIX = "calendar:";

export function makeProperties(d: Deps) {
  const { clock, settings, log } = d.platform;

  /** Есть ли операции расхода по словам из настройки за период (признак по названию контрагента, описанию или категории). */
  async function hasPayment(
    s: ScopedDb,
    words: readonly string[],
    from: LocalDate,
    today: LocalDate,
  ): Promise<boolean> {
    for (const word of words) {
      const found = await d.transactions.list(s, {
        query: word,
        type: "expense",
        from,
        to: today,
        page: 1,
        pageSize: 1,
      });
      if (found.total > 0) return true;
    }
    return false;
  }

  async function evidenceOf(s: ScopedDb, kind: PropertyKind): Promise<Evidence | null> {
    const today = clock.today();
    const from = LocalDate.addDays(today, -(await settings.get(EVIDENCE_DAYS)));
    const words = await settings.get(EVIDENCE_WORDS);
    if (kind === "car") {
      const fuel = await d.transactions.list(s, {
        categoryCode: "car",
        type: "expense",
        from,
        to: today,
        page: 1,
        pageSize: 1,
      });
      if (fuel.total > 0) return "fuel";
      return (await hasPayment(s, words.insurer, from, today)) ? "insurance" : null;
    }
    return (await hasPayment(s, words[kind], from, today)) ? "tax" : null;
  }

  async function liveFacts(s: ScopedDb) {
    return d.profile.getFacts(
      s,
      KINDS.map((kind) => FACT_KEY[kind]),
      clock.today(),
    );
  }

  /** PROF-07: факты об имуществе, которых ещё нет, выводятся из операций как «предположение» (удалённый человеком не возвращается). */
  async function derive(s: ScopedDb): Promise<number> {
    const existing = new Set((await liveFacts(s)).map((fact) => fact.value.key));
    let derived = 0;
    for (const kind of KINDS) {
      if (existing.has(FACT_KEY[kind])) continue;
      const evidence = await evidenceOf(s, kind);
      if (evidence === null) continue;
      const id = await d.profile.upsertDerivedFact(s, {
        value: { key: FACT_KEY[kind], value: true },
        source: "statements",
        sourceRef: `${SOURCE_PREFIX}${evidence}`,
      });
      if (id !== undefined) derived += 1;
    }
    if (derived > 0) log.info({ count: derived }, "calendar.property-derived");
    return derived;
  }

  /** Вопрос баннера: предположение, которое ждёт ответа, иначе — один вопрос про автомобиль, пока о имуществе нет ни одного факта. */
  async function question(s: ScopedDb): Promise<PropertyQuestion | null> {
    const facts = await liveFacts(s);
    for (const kind of KINDS) {
      const assumed = facts.find((f) => f.value.key === FACT_KEY[kind] && f.status === "assumed");
      if (assumed === undefined) continue;
      const evidence = (assumed.sourceRef ?? "").replace(SOURCE_PREFIX, "");
      return {
        kind,
        evidence:
          evidence === "fuel" || evidence === "insurance" || evidence === "tax" ? evidence : null,
      };
    }
    return facts.length === 0 ? { kind: "car", evidence: null } : null;
  }

  /** Ответ человека: факт «подтверждён» («да» или «нет»), «Отменить» возвращает прежнее (предположение или отсутствие факта). */
  async function answer(
    s: ScopedDb,
    input: { kind: PropertyKind; has: boolean },
  ): Promise<{ undoToken: string }> {
    const { undoToken } = await d.profile.setFact(s, {
      value: { key: FACT_KEY[input.kind], value: input.has },
      source: "user",
      channel: "web",
    });
    return { undoToken };
  }

  return { derive, question, answer };
}

export type Properties = ReturnType<typeof makeProperties>;
