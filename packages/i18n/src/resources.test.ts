// Соответствие словарей коду (ADR-0005, P2/EXPL-01): у каждого кода ошибки из каталога контракта есть текст для
// человека, у ключа трассы calc — подпись для «Откуда эта цифра?». calc импортируется только здесь, в тесте.
import { freeBalance, node } from "@kosht/calc";
import { ERROR_CODES } from "@kosht/contract";
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
  it("пространства имён: common, errors, formulas, tools и сайта — shell, ui и экранов", () => {
    expect(NAMESPACES).toEqual([
      "common",
      "errors",
      "formulas",
      "tools",
      "shell",
      "ui",
      "auth",
      "setup",
      "accounts",
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
