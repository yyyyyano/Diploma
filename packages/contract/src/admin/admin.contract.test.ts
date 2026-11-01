// PRIV-07, ADM-30, ADM-60: форма ответов админки — только метаданные учётных записей и системы. Новое поле в ответе
// админки — осознанное решение: тест краснеет, пока его не впишут сюда, и не пускает поля с данными пользователя
// (суммы, операции, факты, переписку, счётчики их строк).
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  AdminResetResult,
  AdminUser,
  JobRun,
  SetTelegramTokenInput,
  SystemOverview,
} from "./admin.contract.ts";
import { AI_CAPABILITIES, AI_TASKS, AiProvider, AiProviders, AiUsage } from "./ai.contract.ts";
import { RatesTable, RateRow } from "./rates.contract.ts";
import {
  LawAdminActs,
  LawCandidates,
  LawDictionary,
  LawFetchEntry,
  LawsOverview,
  LawUpdateEntry,
} from "./laws.contract.ts";

/** Ключи объекта схемы и всех вложенных объектов и массивов — плоским списком путей. */
function paths(schema: z.ZodType, prefix = ""): string[] {
  const def = (schema as { def: { type: string } }).def;
  if (def.type === "object") {
    const shape = (schema as z.ZodObject).shape as Record<string, z.ZodType>;
    return Object.entries(shape).flatMap(([key, value]) => [
      `${prefix}${key}`,
      ...paths(value, `${prefix}${key}.`),
    ]);
  }
  if (def.type === "array") return paths((schema as z.ZodArray<z.ZodType>).element, prefix);
  if (def.type === "nullable" || def.type === "optional") {
    return paths((schema as unknown as { unwrap(): z.ZodType }).unwrap(), prefix);
  }
  return [];
}

const FORBIDDEN = /amount|money|balance|sum|transaction|receipt|statement|fact|message|text|count/i;

describe("PRIV-07: ответы админки — без данных пользователей", () => {
  it("строка «Пользователи» — ровно поля ADM-30", () => {
    expect(paths(AdminUser).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "cloud",
      "demo",
      "email",
      "emailVerified",
      "id",
      "registeredAt",
      "role",
      "self",
      "status",
      "telegram",
    ]);
  });

  it("экран «Система» — задачи, почта, пояс, сеть и Langfuse, без данных домохозяйств", () => {
    const all = paths(SystemOverview);
    expect(all.filter((path) => !path.includes("."))).toEqual([
      "jobs",
      "mail",
      "timeZone",
      "lan",
      "langfuse",
      "telegram",
    ]);
    expect(all.filter((path) => FORBIDDEN.test(path))).toEqual([]);
    expect(paths(JobRun).filter((path) => FORBIDDEN.test(path))).toEqual([]);
  });

  it("пароль SMTP наружу не отдаётся — только «задан / не задан»", () => {
    const mail = paths(SystemOverview).filter((path) => path.startsWith("mail."));
    expect(mail).toContain("mail.passwordSet");
    expect(mail.filter((path) => /password$/i.test(path))).toEqual([]);
  });

  it("токен Telegram-бота наружу не отдаётся — только «задан / не задан / не читается»", () => {
    expect(paths(SystemOverview).filter((path) => path.startsWith("telegram."))).toEqual([
      "telegram.token",
    ]);
    expect(
      SystemOverview.shape.telegram.safeParse({ token: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ" })
        .success,
    ).toBe(false);
  });

  it("токен бота — вид «число:знаки» или null; произвольная строка отвергается", () => {
    expect(SetTelegramTokenInput.safeParse({ token: null }).success).toBe(true);
    expect(
      SetTelegramTokenInput.safeParse({ token: "123456789:AAH-kosht_test_token_abcdefghij" })
        .success,
    ).toBe(true);
    expect(SetTelegramTokenInput.safeParse({ token: "не токен" }).success).toBe(false);
  });

  it("ссылка сброса пароля — только в виде «показана администратору»", () => {
    expect(AdminResetResult.safeParse({ delivery: "email", link: "http://x.test" }).success).toBe(
      false,
    );
    expect(
      AdminResetResult.safeParse({ delivery: "shown", link: "http://127.0.0.1:8140/recovery" })
        .success,
    ).toBe(true);
  });
});

describe("ADM-22, PRIV-07, NFR-16: «Провайдеры ИИ» и «Запросы к ИИ» — числа и метаданные", () => {
  /** Поля, которые в ответах админки об ИИ быть не должны: тексты запросов и ответов, пользователи, значения ключей. */
  const SECRET_OR_PERSONAL =
    /prompt|answer|completion|content|body|message|userId|\busers\b|household|email|secret|apiKey|value/i;

  it("ответы не несут текстов, пользователей и значений ключей", () => {
    expect(paths(AiUsage).filter((path) => SECRET_OR_PERSONAL.test(path))).toEqual([]);
    expect(paths(AiProviders).filter((path) => SECRET_OR_PERSONAL.test(path))).toEqual([]);
  });

  it("ключ провайдера в ответе — только статус «задан / не задан»", () => {
    expect(paths(AiProvider)).toEqual(["id", "cloud", "key"]);
    expect(AiProvider.shape.key.options).toEqual(["set", "unset", "unreadable", "none"]);
  });

  it("«Запросы к ИИ» — цифры журнала: запросы, токены, стоимость, время, ошибки, облако и локально, лимиты, прайс", () => {
    expect(paths(AiUsage).filter((path) => !path.includes("."))).toEqual([
      "period",
      "totals",
      "byTask",
      "byProvider",
      "cloudRequests",
      "localRequests",
      "dailyLimits",
      "prices",
      "langfuseUrl",
    ]);
  });

  it("состав задач и возможностей — один на проводе и в шлюзе (сверяет llm/domain/tasks.test.ts)", () => {
    expect(AI_TASKS).toContain("receipt.extract");
    expect(AI_CAPABILITIES).toContain("embeddings");
  });
});

describe("PRIV-07, LAW-40: вкладка «Законы» — метаданные общей правовой базы, без данных пользователей", () => {
  const USER_DATA =
    /user(?!Agent)|household|owner|amount|money|balance|transaction|receipt|statement|fact|message/i;

  it("сводка — состояние базы, расписание и загрузчик, ровно эти разделы", () => {
    expect(paths(LawsOverview).filter((path) => !path.includes("."))).toEqual([
      "summary",
      "startup",
      "vectors",
      "schedule",
      "newActsMode",
      "loaderContact",
      "userAgent",
    ]);
  });

  it("ни в сводке, ни в списках, журналах, очереди и справочниках нет полей о пользователях и их финансах", () => {
    for (const schema of [
      LawsOverview,
      LawAdminActs,
      LawUpdateEntry,
      LawFetchEntry,
      LawCandidates,
      LawDictionary,
    ]) {
      expect(paths(schema).filter((path) => USER_DATA.test(path))).toEqual([]);
    }
  });

  it("запись журнала запросов — адрес, код ответа, размер и время; тела страницы нет", () => {
    expect(paths(LawFetchEntry).filter((path) => !path.includes("."))).toEqual([
      "at",
      "url",
      "httpStatus",
      "bytes",
      "ms",
      "outcome",
    ]);
  });
});

describe("PRIV-07, ADM-11: «Таблица ставок» — общие числа нормы с источником, без данных пользователей", () => {
  it("строка — параметр, период, значение, источник и кто подтвердил; больше ничего", () => {
    expect(paths(RateRow).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "confirmed",
      "confirmed.by",
      "confirmed.on",
      "drift",
      "group",
      "id",
      "param",
      "source",
      "source.act",
      "source.article",
      "source.linked",
      "source.point",
      "source.url",
      "status",
      "unit",
      "validFrom",
      "validTo",
      "value",
    ]);
  });

  it("в таблице нет ни id подтвердившего администратора, ни полей о пользователях и их финансах", () => {
    expect(
      paths(RatesTable).filter((path) =>
        /user|household|owner|email|balance|transaction/i.test(path),
      ),
    ).toEqual([]);
  });
});
