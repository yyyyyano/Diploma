// PRIV-03: токены NER → отрезки текста; режим деградации без модели; повторный поиск модели; длинный текст кусками.
// Настоящая модель в этой фазе не скачивается (решение пользователя 2026-10-29): токены — синтетические, как их отдаёт
// конвейер; проверка на настоящей модели — вручную после фазы (паспорт llm).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import {
  chunksOf,
  createNerRecognizer,
  loadTransformersClassifier,
  spansFromTokens,
  type NerToken,
} from "./ner.ts";

const token = (entity: string, word: string, score = 0.95): NerToken => ({ entity, word, score });
const cut = (text: string, spans: readonly { start: number; end: number }[]) =>
  spans.map((span) => text.slice(span.start, span.end));

describe("PRIV-03: имена из токенов NER", () => {
  const text = "Платёж: Иванов Иван Иванович, вернул долг";

  it("фамилия, имя и отчество подряд — одна метка", () => {
    const spans = spansFromTokens(text, [
      token("O", "Платёж"),
      token("U-LAST_NAME", "Иванов"),
      token("U-FIRST_NAME", "Иван"),
      token("U-MIDDLE_NAME", "Иванович"),
      token("O", "вернул"),
    ]);
    expect(cut(text, spans)).toEqual(["Иванов Иван Иванович"]);
    expect(spans.every((span) => span.kind === "name")).toBe(true);
  });

  it("кусочки слов («##») склеиваются в одно имя", () => {
    const spans = spansFromTokens("Лукашевич Дмитрий", [
      token("B-LAST_NAME", "Лука"),
      token("I-LAST_NAME", "##шев"),
      token("L-LAST_NAME", "##ич"),
      token("U-FIRST_NAME", "Дмитрий"),
    ]);
    expect(cut("Лукашевич Дмитрий", spans)).toEqual(["Лукашевич Дмитрий"]);
  });

  it("порог 0,8: «Немиге» с уверенностью 0,42 — не адрес и не имя", () => {
    expect(
      spansFromTokens("у Немиге", [token("O", "у"), token("U-STREET", "Немиге", 0.42)]),
    ).toEqual([]);
  });

  it("служебные токены и неизвестные метки пропускаются", () => {
    expect(
      spansFromTokens("текст", [token("O", "[CLS]"), token("O", "текст"), token("B-ORG", "x")]),
    ).toEqual([]);
  });
});

describe("PRIV-03: адреса из токенов NER", () => {
  const text = "Доставка: г. Минск, ул. Притыцкого, д. 156 завтра";

  it("город, улица и дом — один адрес", () => {
    const spans = spansFromTokens(text, [
      token("O", "Доставка"),
      token("U-CITY", "Минск"),
      token("U-STREET", "Притыцкого"),
      token("U-HOUSE", "156"),
      token("O", "завтра"),
    ]);
    expect(cut(text, spans)).toEqual(["Минск, ул. Притыцкого, д. 156"]);
    expect(spans[0]?.kind).toBe("address");
  });

  it("один только город — не адрес: «Минск» в шапке чека остаётся", () => {
    expect(
      spansFromTokens("Магазин, Минск", [token("O", "Магазин"), token("U-CITY", "Минск")]),
    ).toEqual([]);
  });
});

describe("кусками и деградация", () => {
  it("длинный текст режется по пробелам, смещения кусков складываются", async () => {
    const chunks = chunksOf("слово ".repeat(600), 1500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join("")).toBe("слово ".repeat(600));
    expect(chunks[1]?.start).toBe(chunks[0]?.text.length);

    const long = `${"слово ".repeat(400)}Иванов ${"слово ".repeat(100)}`;
    const ner = createNerRecognizer({
      load: async () => async (part) =>
        part.includes("Иванов") ? [token("U-LAST_NAME", "Иванов")] : [],
      log: memoryLogger().log,
      now: () => 0,
    });
    const spans = await ner.recognize(long);
    expect(cut(long, spans)).toEqual(["Иванов"]);
  });

  it("модели нет — пусто и одна строка лога; нашлась позже — подхватывается без перезапуска", async () => {
    const logs = memoryLogger();
    let now = 0;
    let present = false;
    const ner = createNerRecognizer({
      load: async () => (present ? async () => [token("U-LAST_NAME", "Петров")] : undefined),
      log: logs.log,
      now: () => now,
      retryMs: 1000,
    });
    expect(await ner.recognize("Петров")).toEqual([]);
    expect(await ner.recognize("Петров")).toEqual([]);
    expect(logs.lines().filter((line) => line["msg"] === "llm.ner-absent")).toHaveLength(1);
    expect(await ner.available()).toBe(false);

    present = true;
    now = 2000;
    expect(cut("Петров", await ner.recognize("Петров"))).toEqual(["Петров"]);
    expect(await ner.available()).toBe(true);
  });

  it("сбой классификатора не останавливает вызов: пусто и строка лога без текста", async () => {
    const logs = memoryLogger();
    const ner = createNerRecognizer({
      load: async () => async () => {
        throw new Error("onnx упал на секретном тексте");
      },
      log: logs.log,
      now: () => 0,
    });
    expect(await ner.recognize("секретный текст")).toEqual([]);
    expect(logs.lines().some((line) => line["msg"] === "llm.ner-failed")).toBe(true);
    expect(JSON.stringify(logs.lines())).not.toContain("секретном тексте");
  });

  it("файлов модели нет — загрузчик возвращает undefined, библиотека не грузится", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kosht-ner-"));
    try {
      expect(await loadTransformersClassifier(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
