// Соответствие словарей коду (ADR-0005, P2/EXPL-01): у каждого кода ошибки из каталога контракта есть текст для
// человека, у ключа трассы calc — подпись для «Откуда эта цифра?». calc импортируется только здесь, в тесте.
import { freeBalance, node, TRACE_KEYS } from "@kosht/calc";
import {
  ADMIN_NOTIFICATION_KINDS,
  CategorySource,
  ERROR_CODES,
  SYSTEM_CATEGORIES,
  USER_NOTIFICATION_KINDS,
} from "@kosht/contract";
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { createT } from "./create-t.ts";
import { NAMESPACES, resources } from "./resources.ts";

const t = createT();

/** Текст по ключу с точками внутри пространства имён (`fin.freeBalance`) или `undefined`, если его нет. */
function lookup(dictionary: object, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (level, part) =>
        typeof level === "object" && level !== null && Object.hasOwn(level, part)
          ? (level as Record<string, unknown>)[part]
          : undefined,
      dictionary,
    );
}

describe("словари ru", () => {
  it("пространства имён: common, errors, formulas, tools, mail, policy и сайта — shell, ui и экранов", () => {
    expect(NAMESPACES).toEqual([
      "common",
      "errors",
      "formulas",
      "tools",
      "mail",
      "policy",
      "shell",
      "ui",
      "auth",
      "setup",
      "accounts",
      "assistant",
      "mailbox",
      "settings",
      "decisions",
      "notifications",
      "admin",
      "profile",
      "categories",
      "operations",
      "documents",
      "recurring",
      "budget",
    ]);
    expect(Object.keys(resources.ru)).toEqual([...NAMESPACES]);
  });
});

describe("errors — текст на каждый код каталога ошибок", () => {
  it("коды словаря совпадают с каталогом контракта: ни пропусков, ни лишних", () => {
    expect(Object.keys(resources.ru.errors).toSorted()).toEqual([...ERROR_CODES].toSorted());
  });

  it.each(ERROR_CODES)("%s — непустой текст для человека, а не код", (code) => {
    const text = t(`errors:${code}`);
    expect(text).not.toBe(code);
    expect(text.length).toBeGreaterThan(10);
  });
});

describe("accounts — множественные числа счётчика счетов", () => {
  it.each([
    [1, "1 счёт"],
    [3, "3 счёта"],
    [5, "5 счетов"],
    [21, "21 счёт"],
  ])("%i → «%s»", (count, text) => {
    expect(t("accounts:count", { count })).toBe(text);
  });
});

describe("tools — подпись шага у каждого инструмента агента", () => {
  it("list_accounts — «Смотрю ваши счета…»", () => {
    expect(t("tools:list_accounts")).toBe("Смотрю ваши счета…");
  });
});

describe("EXPL-01: formulas — подпись у каждого ключа реестра трассы calc", () => {
  it.each(TRACE_KEYS)("%s — есть подпись", (key) => {
    expect(lookup(resources.ru.formulas, key)).toEqual(expect.any(String));
  });
});

describe("formulas — подпись ключа трассы calc", () => {
  it("fin.freeBalance: у трассы свободного остатка есть подпись (FIN-20)", () => {
    const income = node("fin.averageIncome", Money.of(240_000, "BYN"));
    const { trace } = freeBalance({ averageIncome: income, averageObligations: [] });
    expect(trace.key).toBe("fin.freeBalance");
    expect(lookup(resources.ru.formulas, trace.key)).toBe("Свободный остаток");
  });
});

describe("tools — подпись шага агента", () => {
  it("есть запасная подпись для инструмента без своей", () => {
    expect(t("tools:fallback")).toBe("Выполняю шаг…");
  });
});

describe("NOTIF-02, NOTIF-03: текст у каждого вида уведомления", () => {
  it.each(USER_NOTIFICATION_KINDS)("%s — название, описание и текст", (kind) => {
    const entry = resources.ru.notifications.kinds[kind];
    expect([entry.title, entry.description, entry.text].every((text) => text.length > 0)).toBe(
      true,
    );
  });

  it.each(ADMIN_NOTIFICATION_KINDS)("%s — текст администратору", (kind) => {
    expect(resources.ru.notifications.adminKinds[kind].length).toBeGreaterThan(0);
  });
});

describe("PROF-01: множественные числа профиля", () => {
  it.each([
    [1, "1 ребёнок"],
    [2, "2 ребёнка"],
    [5, "5 детей"],
  ])("дети: %i → «%s»", (count, text) => {
    expect(t("profile:value.children", { count })).toBe(text);
  });

  it.each([
    [1, "1 год"],
    [3, "3 года"],
    [17, "17 лет"],
  ])("возраст: %i → «%s»", (count, text) => {
    expect(t("profile:value.age", { count })).toBe(text);
  });
});

describe("CAT-01: название у каждой встроенной категории и подпись источника", () => {
  it.each(SYSTEM_CATEGORIES.map((category) => category.code))("%s — есть название", (code) => {
    expect(lookup(resources.ru.categories.system, code)).toEqual(expect.any(String));
  });

  it.each(CategorySource.options)("источник %s — есть подпись", (source) => {
    expect(lookup(resources.ru.categories.source, source)).toEqual(expect.any(String));
  });
});
