// PRIV-07, ADM-30, ADM-60: форма ответов админки — только метаданные учётных записей и системы. Новое поле в ответе
// админки — осознанное решение: тест краснеет, пока его не впишут сюда, и не пускает поля с данными пользователя
// (суммы, операции, факты, переписку, счётчики их строк).
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { AdminResetResult, AdminUser, JobRun, SystemOverview } from "./admin.contract.ts";

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
    ]);
    expect(all.filter((path) => FORBIDDEN.test(path))).toEqual([]);
    expect(paths(JobRun).filter((path) => FORBIDDEN.test(path))).toEqual([]);
  });

  it("пароль SMTP наружу не отдаётся — только «задан / не задан»", () => {
    const mail = paths(SystemOverview).filter((path) => path.startsWith("mail."));
    expect(mail).toContain("mail.passwordSet");
    expect(mail.filter((path) => /password$/i.test(path))).toEqual([]);
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
