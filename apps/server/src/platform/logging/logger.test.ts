import { describe, expect, it } from "vitest";
import { withLogContext } from "./context.ts";
import type { LogFields } from "./fields.ts";
import { BAD_KEY, createLogger, type Logger } from "./logger.ts";

const RECEIPT = "0199f2a4-6b1c-7d2e-8f30-1a2b3c4d5e6f";

/** Логгер в память: каждая строка — разобранный JSON. */
function memoryLogger(): { log: Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const log = createLogger({
    role: "api",
    level: "debug",
    destination: { write: (chunk: string) => void chunks.push(chunk) },
  });
  return {
    log,
    lines: () => chunks.map((chunk) => JSON.parse(chunk) as Record<string, unknown>),
  };
}

describe("OBS-01: строка лога — ключ события, поля и контекст", () => {
  it("пишет уровень, роль, ключ и поля из белого списка", () => {
    const { log, lines } = memoryLogger();
    log.info({ receiptId: RECEIPT, ms: 12, code: "RECEIPT_DUPLICATE" }, "receipt.recognized");
    expect(lines()).toEqual([
      expect.objectContaining({
        level: "info",
        role: "api",
        msg: "receipt.recognized",
        receiptId: RECEIPT,
        ms: 12,
        code: "RECEIPT_DUPLICATE",
      }),
    ]);
    expect(lines()[0]?.["time"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("requestId, uid и source берутся из контекста, вложенный контекст дополняет внешний", () => {
    const { log, lines } = memoryLogger();
    withLogContext({ requestId: "req-12345678", source: "http" }, () => {
      withLogContext({ uid: RECEIPT }, () => log.info({}, "auth.login.ok"));
    });
    expect(lines()[0]).toMatchObject({ requestId: "req-12345678", source: "http", uid: RECEIPT });
  });

  it("поля requestId, uid, source из вызова не подменяют контекст", () => {
    const { log, lines } = memoryLogger();
    withLogContext({ requestId: "req-настоящий" }, () =>
      log.info({ requestId: "0199f2a4-6b1c-7d2e-8f30-000000000000" }, "auth.login.ok"),
    );
    expect(lines()[0]).toMatchObject({ requestId: "req-настоящий", droppedFields: 1 });
  });

  it("уровень ниже настроенного не пишется", () => {
    const { log, lines } = memoryLogger();
    log.trace({}, "debug.noise");
    expect(lines()).toEqual([]);
  });
});

describe("OBS-04: белый список полей", () => {
  it("чужие поля отбрасываются, в строке — только их число", () => {
    const { log, lines } = memoryLogger();
    // Обход типа (as) — так поле пришло бы из JS или any: защита при записи.
    const fields = { amount: 249, text: "Молоко", ms: 3 } as LogFields;
    log.info(fields, "receipt.saved");
    expect(lines()[0]).toMatchObject({ ms: 3, droppedFields: 2 });
    expect(lines()[0]).not.toHaveProperty("amount");
    expect(lines()[0]).not.toHaveProperty("text");
  });

  it("id — только uuid, токен — только латиница без пробелов, число — только конечное", () => {
    const { log, lines } = memoryLogger();
    log.info(
      { receiptId: "ivan@mail.by", setting: "система пояс", count: Number.NaN, table: "receipts" },
      "receipt.saved",
    );
    expect(lines()[0]).toMatchObject({ table: "receipts", droppedFields: 3 });
  });

  it("тип не пускает чужое поле", () => {
    const { log } = memoryLogger();
    // @ts-expect-error — поля amount нет в белом списке (OBS-04): проверка «не компилируется».
    log.info({ amount: 249 }, "receipt.saved");
    expect(true).toBe(true);
  });
});

describe("OBS-04: сообщение — только ключ события", () => {
  it.each(["вход ivan@mail.by", "Receipt.Saved", "receipt", "receipt.saved ok", ".x.y"])(
    "«%s» → log.bad-key, текста в строке нет",
    (bad) => {
      const { log, lines } = memoryLogger();
      const key: string = bad;
      // Ключ, собранный в рантайме, тип не пропускает; здесь — проверка защиты при записи.
      (log.info as (fields: object, key: string) => void)({}, key);
      expect(lines()[0]).toMatchObject({ msg: BAD_KEY, badKeyLength: bad.length });
      expect(JSON.stringify(lines())).not.toContain(bad);
    },
  );

  it("тип не пускает строку, собранную в рантайме, и ключ с заглавными буквами", () => {
    const { log } = memoryLogger();
    const email: string = "ivan@mail.by";
    // @ts-expect-error — сообщение не литерал-ключ: данные в строке сообщения (OBS-04).
    log.info({}, `вход ${email}`);
    // @ts-expect-error — заглавные буквы в ключе события.
    log.info({}, "Receipt.saved");
    log.info({}, "receipt.recheck-2.done");
    expect(true).toBe(true);
  });
});
