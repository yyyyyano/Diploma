// LAW-20: разрез акта на фрагменты — короткая статья целиком, длинная по пунктам, указ по пунктам, надстрочные номера,
// исключённые статьи, определения, приложения. Вход — абзацы страницы, без HTML и без сети.
import { describe, expect, it } from "vitest";
import {
  articleKey,
  buildFragments,
  FRAGMENT_LIMIT_CHARS,
  type RawParagraph,
} from "./build-fragments.ts";

const p = (text: string, cls = ""): RawParagraph => ({ cls, text });
const act = { label: "НК (Особенная часть)" };
const long = (n: number) => `Текст пункта ${"слово ".repeat(n)}`.trim();

describe("LAW-20: фрагменты акта", () => {
  it("короткая статья — один фрагмент с путём «акт › глава › статья»", () => {
    const parsed = buildFragments(
      [
        p("ГЛАВА 16"),
        p("Статья 209. Налоговая база", "article"),
        p("1. Налоговая база определяется отдельно.", "point"),
      ],
      act,
    );
    expect(parsed.fragments).toHaveLength(1);
    expect(parsed.fragments[0]).toMatchObject({
      pathKey: "a209",
      articleNo: "209",
      heading: "Налоговая база",
      searchPath: "НК (Особенная часть) › Глава 16 › Статья 209",
      kind: "norm",
    });
    expect(parsed.fragments[0]?.body).toBe(
      "Статья 209. Налоговая база\n1. Налоговая база определяется отдельно.",
    );
    expect(parsed.articleCount).toBe(1);
  });

  it("длинная статья режется по пунктам, а вводная часть остаётся фрагментом статьи", () => {
    const parsed = buildFragments(
      [
        p("Статья 210. Доходы", "article"),
        p("Вводные слова статьи."),
        p(`1. ${long(300)}`, "point"),
        p(`2. ${long(300)}`, "point"),
      ],
      act,
    );
    expect(parsed.fragments.map((f) => f.pathKey)).toEqual(["a210", "a210/p1", "a210/p2"]);
    expect(parsed.fragments[0]?.body).toBe("Статья 210. Доходы\nВводные слова статьи.");
    expect(parsed.fragments[1]?.searchPath).toBe("НК (Особенная часть) › Статья 210 › п. 1");
    expect(parsed.articleCount).toBe(1);
  });

  it("слишком длинный пункт режется по подпунктам", () => {
    const parsed = buildFragments(
      [
        p("Статья 211. Вычеты", "article"),
        p("1. Предоставляются вычеты:", "point"),
        p(`1) ${long(300)}`),
        p(`2) ${long(300)}`),
      ],
      act,
    );
    expect(parsed.fragments.map((f) => f.pathKey)).toEqual([
      "a211",
      "a211/p1",
      "a211/p1/s1",
      "a211/p1/s2",
    ]);
    expect(parsed.fragments[3]?.searchPath).toBe(
      "НК (Особенная часть) › Статья 211 › п. 1 › пп. 2)",
    );
  });

  it("надстрочный номер статьи получает ключ 216.1, а текст остаётся дословным", () => {
    expect(articleKey("216¹")).toBe("216.1");
    expect(articleKey("20¹⁰")).toBe("20.10");
    const parsed = buildFragments(
      [p("Статья 216¹. Особые случаи", "article"), p("1. Текст.")],
      act,
    );
    expect(parsed.fragments[0]).toMatchObject({ pathKey: "a216.1", articleNo: "216.1" });
    expect(parsed.fragments[0]?.body.startsWith("Статья 216¹. Особые случаи")).toBe(true);
  });

  it("исключённая статья хранится со статусом «исключена»", () => {
    const parsed = buildFragments(
      [p("Статья 25. Исключена", "article"), p("Статья 26. Права")],
      act,
    );
    expect(parsed.fragments[0]).toMatchObject({ pathKey: "a25", excluded: true });
    expect(parsed.fragments[1]).toMatchObject({ pathKey: "a26", excluded: false });
  });

  it("указ без статей режется на пункты верхнего уровня", () => {
    const parsed = buildFragments(
      [
        p("УКАЗ ПРЕЗИДЕНТА", "titlek"),
        p("Во исполнение закона ПОСТАНОВЛЯЮ:"),
        p("1. Утвердить Положение.", "point"),
        p("1.1. Срок действия — год."),
        p("2. Контроль возложить.", "point"),
        p("1) на Совет Министров;"),
      ],
      { label: "Указ № 345" },
    );
    expect(parsed.fragments.map((f) => f.pathKey)).toEqual(["intro", "p1", "p1.1", "p2"]);
    expect(parsed.fragments[3]?.body).toBe("2. Контроль возложить.\n1) на Совет Министров;");
    expect(parsed.articleCount).toBe(3);
    expect(parsed.fragments[0]?.body).toBe("Во исполнение закона ПОСТАНОВЛЯЮ:");
  });

  it("определения, вступление в силу и переходные положения получают свой вид", () => {
    const parsed = buildFragments(
      [
        p("Статья 1. Основные термины, используемые в настоящем Законе", "article"),
        p("В настоящем Законе используются следующие термины:"),
        p("Статья 50. Вступление в силу настоящего Закона", "article"),
        p("Статья 51. Переходные положения", "article"),
      ],
      { label: "Закон № 90-З" },
    );
    expect(parsed.fragments.map((f) => f.kind)).toEqual([
      "definitions",
      "effective-date",
      "transitional",
    ]);
  });

  it("приложение — отдельные фрагменты вида «приложение», не длиннее предела", () => {
    const parsed = buildFragments(
      [
        p("Статья 1. Цель", "article"),
        p("ПРИЛОЖЕНИЕ 1"),
        ...Array.from({ length: 40 }, () => p(long(20))),
      ],
      { label: "Закон" },
    );
    const appendix = parsed.fragments.filter((f) => f.kind === "appendix");
    expect(appendix.length).toBeGreaterThan(1);
    expect(appendix.every((f) => f.body.length <= FRAGMENT_LIMIT_CHARS)).toBe(true);
    expect(appendix[0]?.pathKey).toBe("app1/c1");
  });

  it("повтор ключа пути получает суффикс — пара (акт, ключ) уникальна", () => {
    const parsed = buildFragments([p("Статья 5. А", "article"), p("Статья 5. Б", "article")], act);
    expect(parsed.fragments.map((f) => f.pathKey)).toEqual(["a5", "a5~2"]);
  });

  it("страница без статей и пунктов не имеет структуры (основа карантина)", () => {
    const parsed = buildFragments([p("Просто текст без структуры.")], act);
    expect(parsed.hasStructure).toBe(false);
  });

  it("пункт с надстрочным номером «28¹.» — отдельный фрагмент с ключом 28.1 и путём «п. 28¹»", () => {
    const result = buildFragments(
      [
        p("Статья 208. Доходы", "article"),
        p(`28. ${long(300)}`, "point"),
        p(`28¹. ${long(300)}`, "point"),
      ],
      act,
    );
    expect(result.fragments.map((f) => f.pathKey)).toEqual(["a208", "a208/p28", "a208/p28.1"]);
    expect(result.fragments[2]?.searchPath).toBe("НК (Особенная часть) › Статья 208 › п. 28¹");
  });

  it("длинный пункт без подпунктов режется по абзацам на куски не длиннее предела", () => {
    const parsed = buildFragments(
      [
        p("Статья 5. Перечень", "article"),
        p("1. Перечень включает:", "point"),
        ...Array.from({ length: 30 }, () => p(long(25))),
      ],
      act,
    );
    const keys = parsed.fragments.map((f) => f.pathKey);
    expect(keys.slice(0, 3)).toEqual(["a5", "a5/p1", "a5/p1/c2"]);
    expect(parsed.fragments.every((f) => f.body.length <= FRAGMENT_LIMIT_CHARS)).toBe(true);
  });

  it("приложение начинается с абзаца класса append1 («Приложение 2» не заглавными), разделители «_____» отбрасываются", () => {
    const parsed = buildFragments(
      [
        p("Статья 1. Цель", "article"),
        p("Текст статьи."),
        p("______________________________", "snoskiline"),
        p("Приложение 2", "append1"),
        p("к Кодексу", "append"),
        p("Ставки налога", "titlep"),
      ],
      act,
    );
    expect(parsed.fragments.map((f) => f.kind)).toEqual(["norm", "appendix"]);
    expect(parsed.fragments[0]?.body).toBe("Статья 1. Цель\nТекст статьи.");
    expect(parsed.fragments[1]?.body).toBe("Приложение 2\nк Кодексу\nСтавки налога");
  });

  it("перечень изменяющих актов и сноска перед текстом — не нормы и не вступление", () => {
    const parsed = buildFragments(
      [
        p("Закон от 1 января 2002 г. № 90-З"),
        p("Изменения и дополнения:", "changei"),
        p("Закон от 4 января 2003 г. № 183-З", "changeadd"),
        p("*При применении ссылки на Кодекс…", "comment"),
        p("Статья 1. Цель", "article"),
      ],
      act,
    );
    expect(parsed.fragments.map((f) => f.body)).toEqual([
      "Закон от 1 января 2002 г. № 90-З",
      "Статья 1. Цель",
    ]);
  });
});
