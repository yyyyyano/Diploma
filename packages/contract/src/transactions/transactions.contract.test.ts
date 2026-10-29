// TXN-02, TXN-03: форма входа списка (строка запроса GET) и ручного ввода.
import { describe, expect, it } from "vitest";
import {
  CreateTransactionInput,
  MAX_BULK,
  TransactionListInput,
  UpdateTransactionInput,
} from "./transactions.contract.ts";

describe("TXN-02: параметры списка", () => {
  it("пустой запрос — первая страница по 50 строк", () => {
    expect(TransactionListInput.parse({})).toEqual({ page: 1, pageSize: 50 });
  });

  it("числа из строки запроса приводятся: «2», «100», границы суммы в копейках", () => {
    expect(
      TransactionListInput.parse({
        page: "2",
        pageSize: "100",
        amountFrom: "1000",
        type: "expense",
      }),
    ).toMatchObject({ page: 2, pageSize: 100, amountFrom: 1000, type: "expense" });
  });

  it("размер страницы больше 100 и страница 0 не проходят", () => {
    expect(TransactionListInput.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(TransactionListInput.safeParse({ page: "0" }).success).toBe(false);
  });

  it("категория — либо встроенная по коду, либо своя по id, не обе сразу", () => {
    const id = "0199c1a0-0000-7000-8000-000000000001";
    expect(TransactionListInput.safeParse({ categoryCode: "taxi" }).success).toBe(true);
    expect(TransactionListInput.safeParse({ categoryCode: "taxi", categoryId: id }).success).toBe(
      false,
    );
  });
});

describe("TXN-03: ввод операции", () => {
  it("счёт, время, контрагент, комментарий и категория необязательны", () => {
    const input = CreateTransactionInput.parse({
      type: "expense",
      occurredOn: "2026-10-21",
      amount: { minor: 650, currency: "BYN" },
    });
    expect(input).toMatchObject({ occurredTime: null, merchant: null, note: null, category: null });
    expect(input.accountId).toBeUndefined();
  });

  it("время — «чч:мм», строка вроде «25:99» не проходит", () => {
    const base = {
      type: "expense",
      occurredOn: "2026-10-21",
      amount: { minor: 1, currency: "BYN" },
    };
    expect(CreateTransactionInput.safeParse({ ...base, occurredTime: "08:47" }).success).toBe(true);
    expect(CreateTransactionInput.safeParse({ ...base, occurredTime: "25:99" }).success).toBe(
      false,
    );
  });

  it("правка принимает только известные поля, владельца во входе нет", () => {
    const id = "0199c1a0-0000-7000-8000-000000000001";
    expect(UpdateTransactionInput.safeParse({ id, patch: { note: "кофе" } }).success).toBe(true);
    expect(UpdateTransactionInput.safeParse({ id, patch: { userId: id } }).success).toBe(false);
  });

  it("за раз можно выбрать не больше 500 операций", () => {
    expect(MAX_BULK).toBe(500);
  });
});
