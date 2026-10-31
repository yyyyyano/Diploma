// LEGAL-03…06, LEGAL-08, CHAT-10, P3: подстановка меток и проверка вольных цитат. Чистое ядро: версии и акты приходят готовыми,
// модели и БД нет (NFR-11). Главное свойство — в ответ не попадает ни одного слова «из закона», которого нет в тексте версии.
import { describe, expect, it } from "vitest";
import { scanDraft } from "./draft.ts";
import {
  labelParts,
  pendingFor,
  resolveAnswer,
  type PendingChange,
  type SourceAct,
  type SourceVersion,
} from "./resolve-answer.ts";

const F209 = "019e0000-0000-7000-8000-00000000a209";
const F28 = "019e0000-0000-7000-8000-00000000a028";
const FOLD = "019e0000-0000-7000-8000-00000000a0ff";
const FEXC = "019e0000-0000-7000-8000-00000000e113";
const FREP = "019e0000-0000-7000-8000-00000000e999";
const FGONE = "019e0000-0000-7000-8000-0000000000aa";

const version = (patch: Partial<SourceVersion> & { versionId: string }): SourceVersion => ({
  pravoId: "Hk0900071",
  actTitle: "Налоговый кодекс (Особенная часть)",
  pathKey: "a209/p1.1",
  articleNo: "209",
  path: "НК › Статья 209 › п. 1.1",
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

const v209 = version({ versionId: F209 });
const v28 = version({
  versionId: F28,
  pravoId: "H10200090",
  actTitle: "О защите прав потребителей",
  pathKey: "a28/p1",
  articleNo: "28",
  text: "1. Потребитель вправе в течение четырнадцати дней с момента передачи ему непродовольственного товара возвратить товар надлежащего качества.",
  url: "https://pravo.by/document/?guid=3871&p0=H10200090",
});
const vOld = version({ versionId: FOLD, isCurrent: false, editionOn: "2026-10-30" });
const vExcluded = version({
  versionId: FEXC,
  pathKey: "a113",
  articleNo: "113",
  text: "Статья исключена.",
  excluded: true,
});
const vRepealed = version({
  versionId: FREP,
  pravoId: "P31900140",
  actStatus: "repealed",
  repealedOn: "2025-06-01",
});

const act778: SourceAct = {
  pravoId: "C20200778",
  title: "Перечень непродовольственных товаров, не подлежащих обмену и возврату",
  hasText: false,
  status: "active",
  repealedOn: null,
  url: "https://pravo.by/document/?guid=3961&p0=C20200778",
};

function resolve(
  draft: string,
  opts: {
    versions?: readonly SourceVersion[];
    acts?: readonly SourceAct[];
    pending?: Readonly<Record<string, readonly PendingChange[]>>;
    minFreeWords?: number;
  } = {},
) {
  return resolveAnswer({
    items: scanDraft(draft),
    versions: new Map((opts.versions ?? [v209, v28]).map((v) => [v.versionId, v])),
    acts: new Map((opts.acts ?? [act778]).map((a) => [a.pravoId, a])),
    pending: new Map(Object.entries(opts.pending ?? {})),
    minFreeWords: opts.minFreeWords ?? 6,
  });
}

const textOf = (r: ReturnType<typeof resolve>) =>
  r.parts
    .map((p) => (p.type === "text" ? p.text : p.type === "cite" ? `<${p.n}>` : "<убрана>"))
    .join("");

describe("LEGAL-03, LEGAL-05: метка → дословный текст версии, дата редакции, ссылка", () => {
  it("метка даёт блок цитаты: текст версии без изменений, путь, день редакции, ссылка на pravo.by; в тексте — ссылка на блок", () => {
    const r = resolve(`Вычет положен [[F${F209}]].`);
    expect(textOf(r)).toBe("Вычет положен <1>.");
    expect(r.citations).toEqual([
      {
        n: 1,
        kind: "quote",
        versionId: F209,
        pravoId: "Hk0900071",
        actTitle: "Налоговый кодекс (Особенная часть)",
        pathKey: "a209/p1.1",
        path: "НК › Статья 209 › п. 1.1",
        text: v209.text,
        editionOn: "2026-10-30",
        url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
        changedSince: false,
        warnings: [],
      },
    ]);
    expect(r.grounded).toBe(true);
  });

  it("одна и та же версия в двух местах — один блок и один номер", () => {
    const r = resolve(`Раз [[F${F209}]] и два [[F${F209}]], три [[F${F28}]].`);
    expect(textOf(r)).toBe("Раз <1> и два <1>, три <2>.");
    expect(r.citations.map((c) => c.n)).toEqual([1, 2]);
  });

  it("CHAT-10: прежняя версия (текст с тех пор изменился) помечена changedSince", () => {
    const r = resolve(`[[F${FOLD}]]`, { versions: [vOld] });
    expect(r.citations[0]).toMatchObject({ kind: "quote", changedSince: true });
  });

  it("LAW-32: принятые, не вступившие изменения этой статьи — предупреждение у цитаты; чужой статьи — нет", () => {
    const change: PendingChange = {
      description: "Закон от 17 июля 2026 г. № 170-З",
      inForceOn: "2027-01-01",
      articles: ["209", "210"],
    };
    const other: PendingChange = { description: "Закон № 1-З", inForceOn: null, articles: ["300"] };
    const r = resolve(`[[F${F209}]]`, { pending: { Hk0900071: [change, other] } });
    expect(r.citations[0]).toMatchObject({ kind: "quote", warnings: [change] });
  });
});

describe("LEGAL-03: вольная цитата перед меткой проверяется на дословность", () => {
  it("дословная цитата (с иными кавычками, пробелами и регистром) остаётся в тексте как написана", () => {
    const r = resolve(`Вычет — «В  размере 216 белорусских рублей в месяц» [[F${F209}]].`);
    expect(textOf(r)).toBe("Вычет — «В  размере 216 белорусских рублей в месяц» <1>.");
    expect(r.citations[0]?.kind).toBe("quote");
    expect(r.droppedQuotes).toBe(0);
  });

  it("недословная цитата (217 вместо 216) снимается, вместо блока — ссылка с пометкой «цитата не прошла проверку»", () => {
    const r = resolve(`Вычет — «в размере 217 белорусских рублей» [[F${F209}]].`);
    expect(textOf(r)).toBe("Вычет — <1>.");
    expect(r.citations).toEqual([
      {
        n: 1,
        kind: "link",
        reason: "quote-unverified",
        pravoId: "Hk0900071",
        actTitle: "Налоговый кодекс (Особенная часть)",
        pathKey: "a209/p1.1",
        path: "НК › Статья 209 › п. 1.1",
        url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
        repealedOn: null,
      },
    ]);
    expect(r.droppedQuotes).toBe(1);
    expect(JSON.stringify(r)).not.toContain("217");
  });

  it("цитата из другой статьи, привязанная к метке этой, не проходит", () => {
    const r = resolve(`«в течение четырнадцати дней» [[F${F209}]]`);
    expect(r.citations[0]).toMatchObject({ kind: "link", reason: "quote-unverified" });
  });

  it("одна цитата, две метки: проходит, если есть хотя бы в одной; блоки — по каждой метке", () => {
    const r = resolve(`«четырнадцати дней» [[F${F209}]], [[F${F28}]]`);
    expect(r.citations.map((c) => c.kind)).toEqual(["quote", "quote"]);
    expect(r.droppedQuotes).toBe(0);
  });

  it("метка внутри кавычек: недословные слова модели всё равно снимаются", () => {
    const r = resolve(`Вычет «в размере 217 белорусских рублей [[F${F209}]]» в месяц.`);
    expect(textOf(r)).toBe("Вычет <1> в месяц.");
    expect(r.droppedQuotes).toBe(1);
  });

  it("многоточие в цитате: куски проверяются по порядку", () => {
    const ok = resolve(`«в размере 216 … не превышающего 1308» [[F${F209}]]`);
    expect(ok.citations[0]?.kind).toBe("quote");
    const bad = resolve(`«не превышающего 1308 … в размере 216» [[F${F209}]]`);
    expect(bad.citations[0]?.kind).toBe("link");
  });

  it("цитата без метки рядом, длиннее порога слов, проверяется по версиям из этого ответа: нет в них — убирается", () => {
    const draft = (quote: string) => `Срок такой: «${quote}». Подробнее — [[F${F28}]].`;
    const fake = resolve(draft("потребитель вправе вернуть товар в течение тридцати дней"));
    expect(textOf(fake)).toBe("Срок такой: <убрана>. Подробнее — <1>.");
    expect(fake.droppedQuotes).toBe(1);
    const real = resolve(
      draft("в течение четырнадцати дней с момента передачи ему товара").replace(
        "ему товара",
        "ему",
      ),
    );
    expect(textOf(real)).toContain("«в течение четырнадцати дней с момента передачи ему»");
    expect(real.droppedQuotes).toBe(0);
  });

  it("короткая цитата без метки (название, термин) — не цитата закона, остаётся", () => {
    const r = resolve(`Закон «О защите прав потребителей» [[F${F28}]]`);
    expect(textOf(r)).toContain("«О защите прав потребителей»");
    expect(r.droppedQuotes).toBe(0);
  });

  it("без единой метки длинная цитата не проверить — убирается", () => {
    const r = resolve("Закон гласит: «потребитель вправе вернуть товар в течение тридцати дней».");
    expect(textOf(r)).toBe("Закон гласит: <убрана>.");
  });

  it("свойство P3: в итоговом тексте нет ни одной кавычной цитаты длиннее порога, которой нет в версиях ответа", () => {
    const drafts = [
      `«если товар не подошёл по размеру, то его вернут без объяснений» [[F${F28}]]`,
      `Закон прямо говорит: «любой товар можно вернуть в течение месяца». И [[F${F209}]].`,
      `«размер вычета определяется по усмотрению нанимателя в каждом месяце» [[F${F209}]]`,
      "Статья 28 гласит «товар надлежащего качества возврату не подлежит никогда».",
    ];
    for (const draft of drafts) {
      const r = resolve(draft);
      expect(textOf(r)).not.toMatch(/«[^»]*»/u);
    }
  });
});

describe("LEGAL-04, LEGAL-06: метки, которые нельзя подставить", () => {
  it("метка на версию, которой нет, и невалидная метка убираются из ответа и считаются", () => {
    const r = resolve(`Раз [[F${FGONE}]] два [[F12.2]] три.`);
    expect(textOf(r)).toBe("Раз  два  три.");
    expect(r.unresolved).toBe(2);
    expect(r.citations).toEqual([]);
    expect(r.grounded).toBe(false);
  });

  it("акт, исключённый администратором, называть нельзя: как отсутствующий", () => {
    const hidden = version({ versionId: FGONE, actStatus: "excluded" });
    const r = resolve(`[[F${FGONE}]]`, { versions: [hidden] });
    expect(r.unresolved).toBe(1);
    expect(r.citations).toEqual([]);
  });

  it("метка акта без текста (ПСМ № 778) — ссылка без цитаты", () => {
    const r = resolve("Невозвратные товары перечислены в [[AC20200778]].");
    expect(textOf(r)).toBe("Невозвратные товары перечислены в <1>.");
    expect(r.citations).toEqual([
      {
        n: 1,
        kind: "link",
        reason: "no-text",
        pravoId: "C20200778",
        actTitle: act778.title,
        pathKey: null,
        path: null,
        url: act778.url,
        repealedOn: null,
      },
    ]);
    expect(r.grounded).toBe(true);
  });

  it("метка акта, у которого текст в базе есть, — только ссылка «назван» и сама не обосновывает ответ", () => {
    const withText: SourceAct = { ...act778, hasText: true };
    const r = resolve("См. [[AC20200778]].", { acts: [withText] });
    expect(r.citations[0]).toMatchObject({ kind: "link", reason: "named" });
    expect(r.grounded).toBe(false);
  });

  it("исключённая статья — ссылка «статья исключена», без текста", () => {
    const r = resolve(`[[F${FEXC}]]`, { versions: [vExcluded] });
    expect(r.citations[0]).toMatchObject({ kind: "link", reason: "excluded", pathKey: "a113" });
  });

  it("акт утратил силу — ссылка «утратил силу» с датой, текст не цитируется", () => {
    const r = resolve(`[[F${FREP}]]`, { versions: [vRepealed] });
    expect(r.citations[0]).toMatchObject({
      kind: "link",
      reason: "repealed",
      repealedOn: "2025-06-01",
    });
  });

  it("метка на неизвестный акт убирается", () => {
    const r = resolve("См. [[AZ99999999]].");
    expect(r.unresolved).toBe(1);
  });

  it("цитата, привязанная только к исключённой статье, проверить не на чем — убирается", () => {
    const r = resolve(`«Статья исключена» [[F${FEXC}]]`, { versions: [vExcluded] });
    expect(textOf(r)).toBe("<1>");
    expect(r.droppedQuotes).toBe(1);
  });

  it("цитата, привязанная к метке, которой нет, убирается и оставляет пометку", () => {
    const r = resolve(`Срок — «четырнадцать дней» [[F${FGONE}]].`);
    expect(textOf(r)).toBe("Срок — <убрана>.");
  });
});

describe("LEGAL-05: подписи пути и предупреждения", () => {
  it("labelParts разбирает ключ пути: статья, пункт, подпункт, часть, приложение", () => {
    expect(labelParts("a209")).toEqual({ article: "209", point: null, subpoint: null, part: null });
    expect(labelParts("a209/p1.2")).toMatchObject({ article: "209", point: "1.2" });
    expect(labelParts("a216.1/p3/s2")).toMatchObject({
      article: "216.1",
      point: "3",
      subpoint: "2",
    });
    expect(labelParts("a13/c2")).toMatchObject({ article: "13", part: "2" });
    expect(labelParts("p3/s2")).toMatchObject({ article: null, point: "3", subpoint: "2" });
    expect(labelParts("intro")).toEqual({ article: null, point: null, subpoint: null, part: null });
  });

  it("pendingFor: изменение без разобранных статей относится ко всему акту; с разобранными — только к названным", () => {
    const wide: PendingChange = { description: "Закон № 5-З", inForceOn: null, articles: [] };
    const narrow: PendingChange = {
      description: "Закон № 6-З",
      inForceOn: null,
      articles: ["209"],
    };
    expect(pendingFor([wide, narrow], "209")).toEqual([wide, narrow]);
    expect(pendingFor([wide, narrow], "210")).toEqual([wide]);
    expect(pendingFor([narrow], null)).toEqual([]);
  });
});
