// LEGAL-03…08, CHAT-05/06/10, LAW-15 в сценарии постобработки ответа: соседи (legal-base, norm-tables) — маленькие фальшивки с теми
// же формами данных, что у настоящих фасадов (настоящие — в main/legal-consult.int.test.ts); модели нет (NFR-11).
import { createLegalT } from "@kosht/i18n";
import { describe, expect, it } from "vitest";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { CitationSource } from "../../legal-base/index.ts";
import type { RateAnswer } from "../../norm-tables/index.ts";
import { makeFinalizeAnswer, type FinalizeDeps } from "./finalize-answer.ts";

const F209 = "019e0000-0000-7000-8000-00000000a209";
const FOLD = "019e0000-0000-7000-8000-00000000a0ff";
const F28 = "019e0000-0000-7000-8000-00000000a028";
const FGONE = "019e0000-0000-7000-8000-0000000000aa";

const source = (patch: Partial<CitationSource> & { versionId: string }): CitationSource => ({
  pravoId: "Hk0900071",
  actTitle: "Налоговый кодекс Республики Беларусь (Особенная часть)",
  pathKey: "a209/p1.1",
  articleNo: "209",
  path: "НК › Глава 16 › Статья 209 › п. 1.1",
  text: "1.1. в размере 216 белорусских рублей в месяц при получении дохода, не превышающего 1308 белорусских рублей в месяц;",
  excluded: false,
  isCurrent: true,
  actStatus: "active",
  repealedOn: null,
  hasText: true,
  editionOn: "2026-10-30",
  url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
  ...patch,
});

const card = (pravoId: string, title: string, hasText: boolean, status = "active") => ({
  pravoId,
  title,
  kind: "law",
  isNpa: true,
  hasText,
  status,
  loadState: hasText ? "loaded" : "card-only",
  loadedAt: null,
  articleCount: null,
  repealedOn: status === "repealed" ? "2025-06-01" : null,
});

interface World {
  versions?: readonly CitationSource[];
  cards?: readonly ReturnType<typeof card>[];
  pending?: Record<string, { description: string; inForceOn: string | null; articles: string[] }[]>;
  first?: Record<string, string>;
  rate?: RateAnswer;
  demandFails?: boolean;
}

function setup(world: World = {}) {
  const demand: { topic: string; actIds: readonly string[] }[] = [];
  const rateCalls: [string, string][] = [];
  const logger = memoryLogger();
  const versions = world.versions ?? [
    source({ versionId: F209 }),
    source({ versionId: FOLD, isCurrent: false, editionOn: "2026-10-23" }),
    source({
      versionId: F28,
      pravoId: "H10200090",
      actTitle: "О защите прав потребителей",
      pathKey: "a28/p1",
      articleNo: "28",
      text: "1. Потребитель вправе в течение четырнадцати дней возвратить товар надлежащего качества.",
      url: "https://pravo.by/document/?guid=3871&p0=H10200090",
    }),
  ];
  const cards = world.cards ?? [
    card("Hk0900071", "Налоговый кодекс Республики Беларусь (Особенная часть)", true),
    card("H10200090", "О защите прав потребителей", true),
    card("C20200778", "Перечень непродовольственных товаров, не подлежащих обмену", false),
    card("P31900140", "Указ о возмещении таможенных пошлин", true, "repealed"),
    card("H99999999", "Скрытый акт", true, "excluded"),
  ];
  const deps: FinalizeDeps = {
    legalBase: {
      citations: async (ids) => versions.filter((v) => ids.includes(v.versionId)),
      actCard: async (id) => cards.find((c) => c.pravoId === id),
      pendingChanges: async (pravoId) =>
        (world.pending?.[pravoId] ?? []).map((c, i) => ({
          id: String(i),
          changeKey: String(i),
          description: c.description,
          inForceOn: c.inForceOn,
          articles: c.articles,
          firstSeenAt: new Date("2026-10-30T00:00:00Z"),
          analyzedAt: null,
          notifiedAt: null,
        })),
      recordDemand: async (input) => {
        if (world.demandFails === true) throw new Error("журнал недоступен");
        demand.push({ topic: input.topic, actIds: input.actIds });
      },
      firstEditionOn: async (pravoId) => world.first?.[pravoId] ?? null,
    },
    rate: async (param, day) => {
      rateCalls.push([param, day]);
      return world.rate ?? { found: false, reason: "no-data" };
    },
    t: createLegalT(),
    minFreeWords: async () => 6,
    log: logger.log,
  };
  return { finalize: makeFinalizeAnswer(deps), demand, rateCalls, logger };
}

const text = (parts: readonly { type: string; text?: string; n?: number }[]) =>
  parts.map((p) => (p.type === "text" ? p.text : `<${String(p.n)}>`)).join("");

describe("LEGAL-03, LEGAL-05, LEGAL-07: ответ с цитатами", () => {
  it("метка → блок: дословный текст версии, «в редакции на 30.10.2026», ссылка на pravo.by, подпись «ст. 209, п. 1.1»; пометка последней", async () => {
    const { finalize, demand } = setup();
    const answer = await finalize({
      draft: `Стандартный вычет — 216 рублей в месяц [[F${F209}]].`,
      topic: "taxes",
      candidateActIds: [],
    });
    expect(answer.outcome).toBe("cited");
    expect(text(answer.parts)).toBe("Стандартный вычет — 216 рублей в месяц <1>.");
    expect(answer.citations).toEqual([
      expect.objectContaining({
        n: 1,
        kind: "quote",
        versionId: F209,
        label: "ст. 209, п. 1.1",
        edition: "в редакции на 30.10.2026",
        url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
        changedSince: false,
        notes: [],
      }),
    ]);
    expect(answer.citations[0]).toMatchObject({ text: expect.stringContaining("в размере 216") });
    expect(answer.notices.at(-1)).toEqual({
      kind: "disclaimer",
      text: "Не является юридической консультацией.",
    });
    expect(answer.versionIds).toEqual([F209]);
    // Тема в журнал спроса пишется только при «в моей базе нет».
    expect(demand).toEqual([]);
  });

  it("CHAT-10: прежняя версия — пометка «текст изменился»; LAW-32: принятое изменение этой статьи — предупреждение с датой", async () => {
    const { finalize } = setup({
      pending: {
        Hk0900071: [
          { description: "Закон № 170-З", inForceOn: "2027-01-01", articles: ["209"] },
          { description: "Закон № 999-З", inForceOn: null, articles: ["300"] },
        ],
      },
    });
    const answer = await finalize({
      draft: `[[F${FOLD}]] и [[F${F209}]]`,
      topic: null,
      candidateActIds: [],
    });
    const [old, current] = answer.citations;
    expect(old).toMatchObject({ kind: "quote", changedSince: true });
    expect(old?.kind === "quote" && old.notes[0]).toContain("с тех пор изменился");
    expect(current).toMatchObject({
      kind: "quote",
      notes: [
        "Приняты изменения, ещё не вошедшие в текст: Закон № 170-З; вступают в силу 01.01.2027.",
      ],
    });
  });

  it("недословная цитата заменена ссылкой с пометкой, слов модели в ответе нет", async () => {
    const { finalize } = setup();
    const answer = await finalize({
      draft: `Вычет — «в размере 217 белорусских рублей» [[F${F209}]].`,
      topic: null,
      candidateActIds: [],
    });
    expect(text(answer.parts)).toBe("Вычет — <1>.");
    expect(answer.citations[0]).toMatchObject({
      kind: "link",
      reason: "quote-unverified",
      label: "ст. 209, п. 1.1",
      note: "Цитата не прошла проверку на дословность, поэтому не показана — откройте норму по ссылке.",
    });
    expect(JSON.stringify(answer)).not.toContain("217");
    expect(answer.versionIds).toEqual([]);
  });

  it("непроверяемые метки убираются и называются одной пометкой", async () => {
    const { finalize } = setup();
    const answer = await finalize({
      draft: `Раз [[F${FGONE}]], два [[F12.2]], три [[F${F209}]].`,
      topic: null,
      candidateActIds: [],
    });
    expect(answer.outcome).toBe("cited");
    expect(answer.notices.map((n) => n.kind)).toEqual(["unresolved", "disclaimer"]);
    expect(answer.notices[0]?.text).toBe(
      "2 ссылки на нормы я не смог проверить, поэтому не показал их.",
    );
  });
});

describe("LEGAL-06: акты без текста", () => {
  it("метка акта-карточки — ссылка без цитаты: «текста этого акта в моей базе нет»", async () => {
    const { finalize } = setup();
    const answer = await finalize({
      draft: "Невозвратные товары перечислены в [[AC20200778]].",
      topic: null,
      candidateActIds: [],
    });
    expect(answer.outcome).toBe("cited");
    expect(answer.citations).toEqual([
      expect.objectContaining({
        kind: "link",
        reason: "no-text",
        url: "https://pravo.by/document/?guid=3961&p0=C20200778",
        note: "Текста этого акта в моей базе нет — откройте его по ссылке.",
      }),
    ]);
  });

  it("акт утратил силу — с датой; исключённый администратором — как отсутствующий", async () => {
    const { finalize } = setup();
    const answer = await finalize({
      draft: "Старое [[AP31900140]], скрытое [[AH99999999]].",
      topic: null,
      candidateActIds: [],
    });
    expect(answer.citations[0]).toMatchObject({
      reason: "repealed",
      note: "Акт утратил силу с 01.06.2025.",
    });
    expect(answer.citations).toHaveLength(1);
    expect(answer.notices.map((n) => n.kind)).toContain("unresolved");
  });
});

describe("LEGAL-04, LAW-15: «в моей базе нет»", () => {
  it("модель ответила по памяти без меток — текст заменён: нормы нет, акт из каталога назван, тема и акты записаны в журнал спроса", async () => {
    const { finalize, demand } = setup();
    const answer = await finalize({
      draft: "Согласно статье 99 вернуть можно в течение трёх лет.",
      topic: "consumer",
      candidateActIds: ["H10200090", "C20200778", "H99999999", "не-id"],
    });
    expect(answer.outcome).toBe("no-base");
    const shown = text(answer.parts);
    expect(shown).toContain("В моей базе нет норм");
    expect(shown).not.toContain("трёх лет");
    expect(answer.citations.map((c) => [c.kind === "link" && c.reason, c.pravoId])).toEqual([
      ["named", "H10200090"],
      ["no-text", "C20200778"],
    ]);
    expect(shown).toContain("Вопрос может регулировать акт «О защите прав потребителей»");
    expect(shown).toContain("его текста в моей базе нет");
    expect(answer.notices.at(-1)?.kind).toBe("disclaimer");
    // Журнал — только тема и найденные акты, без текста вопроса и ответа (PRIV).
    expect(demand).toEqual([{ topic: "consumer", actIds: ["H10200090", "C20200778"] }]);
    expect(answer.versionIds).toEqual([]);
  });

  it("без темы журнал спроса не пишется; без актов — ответ тоже честный", async () => {
    const { finalize, demand } = setup();
    const answer = await finalize({ draft: "Не знаю.", topic: null, candidateActIds: [] });
    expect(answer.outcome).toBe("no-base");
    expect(answer.citations).toEqual([]);
    expect(demand).toEqual([]);
  });

  it("сбой журнала спроса не ломает ответ; в лог — только ключ без темы и актов", async () => {
    const { finalize, logger } = setup({ demandFails: true });
    const answer = await finalize({ draft: "?", topic: "taxes", candidateActIds: ["Hk0900071"] });
    expect(answer.outcome).toBe("no-base");
    const line = logger.lines().find((l) => l["msg"] === "law.demand-failed");
    expect(line).toBeDefined();
    expect(logger.text()).not.toContain("taxes");
    expect(logger.text()).not.toContain("Hk0900071");
  });

  it("метки есть, но ни одна не подставилась — это тоже «в моей базе нет», выдуманная норма не показывается", async () => {
    const { finalize, demand } = setup();
    const answer = await finalize({
      draft: `Статья 777 разрешает всё [[F${FGONE}]].`,
      topic: "fines",
      candidateActIds: [],
    });
    expect(answer.outcome).toBe("no-base");
    expect(text(answer.parts)).not.toContain("777");
    expect(answer.notices.map((n) => n.kind)).toEqual(["unresolved", "disclaimer"]);
    expect(demand).toEqual([{ topic: "fines", actIds: [] }]);
  });

  it("не больше трёх названных актов", async () => {
    const cards = ["Aaaaaa1", "Aaaaaa2", "Aaaaaa3", "Aaaaaa4", "Aaaaaa5"].map((id) =>
      card(id, `Акт ${id}`, true),
    );
    const { finalize } = setup({ cards });
    const answer = await finalize({
      draft: "",
      topic: null,
      candidateActIds: cards.map((c) => c.pravoId),
    });
    expect(answer.citations).toHaveLength(3);
  });
});

describe("LEGAL-08: вопрос о прошлой дате", () => {
  const confirmed: RateAnswer = {
    found: true,
    param: "ndfl.std-deduction.base",
    unit: "byn-minor",
    value: 21_600,
    validFrom: "2025-01-01",
    validTo: "2025-12-31",
    source: { act: "Hk0900071", article: "209", point: "1.1", url: null },
    confirmedBy: "admin",
    confirmedOn: "2026-11-02",
    versionId: null,
  };
  const asOf = (day: string, param?: string) => ({
    draft: `Вычет [[F${F209}]].`,
    topic: null,
    candidateActIds: [],
    asOf: { day, ...(param === undefined ? {} : { param }) },
  });

  it("день раньше первой редакции: оговорка «прежнюю редакцию процитировать не могу» и ставка из таблицы с источником", async () => {
    const { finalize, rateCalls } = setup({ first: { Hk0900071: "2026-10-30" }, rate: confirmed });
    const answer = await finalize(asOf("2025-06-01", "ndfl.std-deduction.base"));
    expect(rateCalls).toEqual([["ndfl.std-deduction.base", "2025-06-01"]]);
    expect(answer.notices.map((n) => n.kind)).toEqual(["past-date", "rate", "disclaimer"]);
    expect(answer.notices[0]?.text).toBe(
      "В моей базе текст акта «Налоговый кодекс Республики Беларусь (Особенная часть)» есть в редакции на 30.10.2026. Прежнюю редакцию процитировать не могу.",
    );
    expect(answer.notices[1]?.text).toBe(
      "Сумму на 01.06.2025 беру из таблицы ставок: 216,00\u00A0BYN (источник: Налоговый кодекс Республики Беларусь (Особенная часть), ст. 209, п. 1.1; подтверждено администратором 02.11.2026).",
    );
  });

  it("процентная ставка — в процентах из сотых долей: 13 % = 1300", async () => {
    const { finalize } = setup({
      first: { Hk0900071: "2026-10-30" },
      rate: {
        ...confirmed,
        unit: "percent-bp",
        value: 1300,
        source: { act: null, article: null, point: null, url: null },
        confirmedBy: "developer",
      },
    });
    const answer = await finalize(asOf("2025-06-01", "ndfl.rate.base"));
    expect(answer.notices[1]?.text).toBe(
      "Сумму на 01.06.2025 беру из таблицы ставок: 13,00 % (источник: источник не указан; подтверждено разработчиком 02.11.2026).",
    );
  });

  it("значения нет или оно ждёт подтверждения — так и сказано, числа не называются", async () => {
    const missing = await setup({ first: { Hk0900071: "2026-10-30" } }).finalize(
      asOf("2025-06-01", "x.y"),
    );
    expect(missing.notices[1]?.text).toBe(
      "Значения на 01.06.2025 в таблице ставок нет, поэтому назвать сумму не могу.",
    );
    const waiting = await setup({
      first: { Hk0900071: "2026-10-30" },
      rate: { found: false, reason: "unconfirmed" },
    }).finalize(asOf("2025-06-01", "x.y"));
    expect(waiting.notices[1]?.text).toBe(
      "Значение на 01.06.2025 в таблице ставок ждёт подтверждения, поэтому назвать сумму не могу.",
    );
  });

  it("без параметра ставки — только оговорка; день не раньше первой редакции или акта в базе нет — ничего", async () => {
    const world = { first: { Hk0900071: "2026-10-30" }, rate: confirmed };
    const only = await setup(world).finalize(asOf("2025-06-01"));
    expect(only.notices.map((n) => n.kind)).toEqual(["past-date", "disclaimer"]);
    const sameDay = await setup(world).finalize(asOf("2026-10-30", "ndfl.std-deduction.base"));
    expect(sameDay.notices.map((n) => n.kind)).toEqual(["disclaimer"]);
    const noSnapshots = await setup({ rate: confirmed }).finalize(
      asOf("2025-06-01", "ndfl.std-deduction.base"),
    );
    expect(noSnapshots.notices.map((n) => n.kind)).toEqual(["disclaimer"]);
  });

  it("«в моей базе нет» тоже получает ставку на прошлую дату: акт — из явного asOf.pravoId", async () => {
    const { finalize } = setup({ first: { Hk0900071: "2026-10-30" }, rate: confirmed });
    const answer = await finalize({
      draft: "",
      topic: null,
      candidateActIds: [],
      asOf: { day: "2025-06-01", param: "ndfl.std-deduction.base", pravoId: "Hk0900071" },
    });
    expect(answer.outcome).toBe("no-base");
    expect(answer.notices.map((n) => n.kind)).toEqual(["past-date", "rate", "disclaimer"]);
  });
});
