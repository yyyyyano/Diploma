// LEGAL-02…08, LAW-15, CHAT-10, P3 сквозь корень композиции на настоящем Postgres и настоящих страницах pravo.by (90-З, НК; без сети):
// метка версии фрагмента → дословный текст из базы с датой редакции и ссылкой; подмена числа в цитате не проходит; нет нормы — «в моей базе
// нет» с актом-карточкой и строкой журнала спроса без текста вопроса; вопрос о прошлой дате — ставка из таблицы, а не цитата прежней редакции.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LegalConsultFacade } from "../modules/legal-consult/index.ts";
import {
  sessionCookie,
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

const FIXTURES = fileURLToPath(
  new URL("../modules/legal-base/__fixtures__/pravo-by", import.meta.url),
);

let db: TestDb;
let stack: HttpStack;
let dir: string;
let root: string;
let consult: LegalConsultFacade;

beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-consult-"));
  await cp(FIXTURES, dir, { recursive: true });
  stack = await startHttpStack(db, {
    env: { LEGAL_SOURCE: "fixtures", LEGAL_FIXTURES_DIR: dir, LLM_MODELS_DOWNLOAD: "0" },
  });
  const admin = { email: "root@example.test", password: STACK_PASSWORD };
  const setup = await stack.call("local", "/identity/setup", { body: admin });
  if (setup.status !== 200) throw new Error(`первый запуск не прошёл: ${String(setup.status)}`);
  root = sessionCookie(await stack.call("local", "/identity/sign-in", { body: admin }));
  await vi.waitFor(
    async () => {
      const response = await stack.call("local", "/legal-base/startup-progress");
      const progress = (await response.json()) as { state: string };
      if (progress.state !== "ready") throw new Error("каталог ещё загружается");
    },
    { timeout: 30_000, interval: 300 },
  );
  const module = stack.api.modules.find((m) => m.id === "legal-consult");
  if (module === undefined) throw new Error("модуль legal-consult не создан");
  consult = module.facade as LegalConsultFacade;
});
afterAll(async () => {
  await stack.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

async function version(
  pravoId: string,
  where: { pathKey: string } | { article: string; like: string },
) {
  const [filter, value] =
    "pathKey" in where
      ? ["f.path_key = $2", where.pathKey]
      : ["f.article_no = $2 and v.body like $3", where.article];
  const params = "pathKey" in where ? [pravoId, value] : [pravoId, value, where.like];
  const rows = await db.owner.query<{ id: string; body: string; fetched_at: Date }>(
    `select v.id, v.body, s.fetched_at
       from legal_fragment_versions v
       join legal_fragments f on f.id = v.fragment_id
       join legal_acts a on a.id = f.act_id
       join legal_act_snapshots s on s.id = a.current_snapshot_id
      where a.pravo_id = $1 and ${filter} and v.is_current
      order by f.position
      limit 1`,
    params,
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error(`нет фрагмента ${JSON.stringify(where)} акта ${pravoId}`);
  return row;
}

const dmy = (at: Date) => {
  const [y, m, d] = at.toISOString().slice(0, 10).split("-");
  return `${d ?? ""}.${m ?? ""}.${y ?? ""}`;
};

describe("LEGAL-03, LEGAL-05: цитата по метке — настоящий текст из базы", () => {
  it("метка → дословный текст п. 1.1 ст. 209 НК, дата редакции из снимка, ссылка на pravo.by, пометка «Не является юридической консультацией»", async () => {
    const v = await version("Hk0900071", { pathKey: "a209/p1.1" });
    const answer = await consult.finalizeAnswer({
      draft: `Стандартный вычет — 216 рублей в месяц [[F${v.id}]].`,
      topic: "taxes",
      candidateActIds: [],
    });
    expect(answer.outcome).toBe("cited");
    expect(answer.citations[0]).toMatchObject({
      kind: "quote",
      versionId: v.id,
      text: v.body,
      label: "ст. 209, п. 1.1",
      edition: `в редакции на ${dmy(v.fetched_at)}`,
      url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
      changedSince: false,
    });
    expect(answer.notices.at(-1)).toEqual({
      kind: "disclaimer",
      text: "Не является юридической консультацией.",
    });
    expect(answer.versionIds).toEqual([v.id]);
  });

  it("вольная цитата из текста нормы с другими кавычками и пробелами остаётся; с чужим числом — заменена ссылкой", async () => {
    const v = await version("Hk0900071", { pathKey: "a209/p1.1" });
    const ok = await consult.finalizeAnswer({
      draft: `Сказано: „в размере 216  белорусских рублей в месяц“ [[F${v.id}]].`,
      topic: null,
      candidateActIds: [],
    });
    expect(ok.parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("216") });
    expect(ok.citations[0]?.kind).toBe("quote");

    const forged = await consult.finalizeAnswer({
      draft: `Сказано: «в размере 316 белорусских рублей в месяц» [[F${v.id}]].`,
      topic: null,
      candidateActIds: [],
    });
    expect(JSON.stringify(forged)).not.toContain("316");
    expect(forged.citations[0]).toMatchObject({ kind: "link", reason: "quote-unverified" });
  });

  it("настоящая ст. 28 90-З: срок «четырнадцати дней» процитирован дословно", async () => {
    const v = await version("H10200090", { article: "28", like: "%в течение четырнадцати дней%" });
    const answer = await consult.finalizeAnswer({
      draft: `Потребитель вправе «в течение четырнадцати дней» [[F${v.id}]] вернуть товар надлежащего качества.`,
      topic: "consumer",
      candidateActIds: [],
    });
    expect(answer.outcome).toBe("cited");
    expect(answer.citations[0]).toMatchObject({ kind: "quote", label: "ст. 28" });
    expect(answer.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("«в течение четырнадцати дней»"),
    });
  });
});

describe("LEGAL-04, LEGAL-06, LAW-15: «в моей базе нет»", () => {
  it("нет нормы: акт-карточка (ПСМ № 778) назван ссылкой без цитаты, в журнале спроса — тема и акт, текста вопроса нет", async () => {
    const answer = await consult.finalizeAnswer({
      draft: "Статья 999 разрешает возвращать всё в течение года.",
      topic: "consumer",
      candidateActIds: ["C20200778"],
    });
    expect(answer.outcome).toBe("no-base");
    expect(answer.citations).toEqual([
      expect.objectContaining({
        kind: "link",
        reason: "no-text",
        url: "https://pravo.by/document/?guid=3961&p0=C20200778",
      }),
    ]);
    expect(JSON.stringify(answer.parts)).not.toContain("999");
    const log = await db.owner.query<{ topic: string; pravo_ids: string[] }>(
      "select topic, pravo_ids from legal_demand_log",
    );
    expect(log.rows).toEqual([{ topic: "consumer", pravo_ids: ["C20200778"] }]);
  });
});

describe("LEGAL-08: вопрос о прошлой дате — ставка из таблицы", () => {
  it("до первой редакции в базе: оговорка + подтверждённое значение прошлого года из таблицы ставок; неподтверждённого — не называется", async () => {
    const v = await version("Hk0900071", { pathKey: "a209/p1.2" });
    const post = (path: string, body: unknown) => stack.call("local", path, { cookie: root, body });
    const proposed = await post("/admin/rates/propose", {
      param: "ndfl.std-deduction.child",
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
      value: 5800,
      sourceAct: "Hk0900071",
      sourceArticle: "209",
      sourcePoint: "1.2",
      sourceUrl: null,
    });
    expect(proposed.status).toBe(200);
    const table = (await (await stack.call("local", "/admin/rates", { cookie: root })).json()) as {
      items: { id: string; param: string; validFrom: string }[];
    };
    const id =
      table.items.find(
        (r) => r.param === "ndfl.std-deduction.child" && r.validFrom === "2025-01-01",
      )?.id ?? "";

    const ask = () =>
      consult.finalizeAnswer({
        draft: `Вычет на ребёнка — [[F${v.id}]].`,
        topic: "taxes",
        candidateActIds: [],
        asOf: { day: "2025-06-01", param: "ndfl.std-deduction.child" },
      });
    // Пока значение ждёт подтверждения, число не называется.
    const waiting = await ask();
    expect(waiting.notices.map((n) => n.kind)).toEqual(["past-date", "rate", "disclaimer"]);
    expect(waiting.notices[0]?.text).toContain("Прежнюю редакцию процитировать не могу.");
    expect(waiting.notices[1]?.text).toBe(
      "Значение на 01.06.2025 в таблице ставок ждёт подтверждения, поэтому назвать сумму не могу.",
    );

    expect((await post("/admin/rates/confirm", { id })).status).toBe(200);
    const answer = await ask();
    expect(answer.notices[1]?.text).toMatch(
      /^Сумму на 01\.06\.2025 беру из таблицы ставок: 58,00 BYN \(источник: .*ст\. 209, п\. 1\.2; подтверждено администратором \d\d\.\d\d\.\d{4}\)\.$/u,
    );
  });
});
