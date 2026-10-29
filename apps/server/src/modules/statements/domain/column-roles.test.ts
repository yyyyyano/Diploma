// STMT-04: смысл колонки по заголовку — без модели.
import { describe, expect, it } from "vitest";
import { normalizeHeader, roleOfHeader } from "./column-roles.ts";

describe("STMT-04: заголовки колонок", () => {
  it.each([
    ["Дата", "date"],
    ["Дата операции", "date"],
    ["Дата проводки", "date"],
    ["Date", "date"],
    ["Время", "time"],
    ["Описание операции", "description"],
    ["Назначение платежа", "description"],
    ["Контрагент", "description"],
    ["Details", "description"],
    ["Сумма", "amount"],
    ["Сумма, BYN", "amount"],
    ["Amount", "amount"],
    ["Сумма операции в валюте счёта", "amount"],
    ["Сумма операции", "operationAmount"],
    ["Приход", "credit"],
    ["Кредит", "credit"],
    ["Расход", "debit"],
    ["Дебет", "debit"],
    ["Остаток", "balance"],
    ["Остаток по счёту", "balance"],
    ["Balance", "balance"],
    ["Валюта", "currency"],
    ["Номер операции", "operationId"],
  ] as const)("«%s» — %s", (header, role) => {
    expect(roleOfHeader(header)).toBe(role);
  });

  it("незнакомые названия — ignore: «Проведено», «Поступило», «Выбыло» словарь не знает, их определит модель", () => {
    for (const header of ["Проведено", "Поступило", "Выбыло", "Итого на счёте", "", "MCC"]) {
      expect(roleOfHeader(header)).toBe("ignore");
    }
  });

  it("регистр, «ё», пробелы и пунктуация по краям не мешают", () => {
    expect(normalizeHeader("  ОСТАТОК  по счёту: ")).toBe("остаток по счету");
    expect(roleOfHeader("  ДАТА ОПЕРАЦИИ ")).toBe("date");
  });
});
