// PRIV-03: метка может прийти кусками — демаскирование потока не должно показать «[ИМ» и «Я_1]» открытым текстом.
import { describe, expect, it } from "vitest";
import { createStreamUnmasker, jsonEscaped, plain } from "./stream-unmasker.ts";

const map = new Map([
  ["[ИМЯ_1]", "Анна"],
  ["[СЧЁТ_1]", 'BY20 "тест"'],
]);

function run(chunks: string[], replace = plain(map)): string[] {
  const unmasker = createStreamUnmasker(replace);
  return [...chunks.map((chunk) => unmasker.push(chunk)), unmasker.flush()];
}

describe("PRIV-03: поток с метками, разрезанными на куски", () => {
  it("метка по буквам — наружу уходит уже настоящее имя, обрывков меток нет", () => {
    const out = run(["Привет, ", "[", "ИМ", "Я_", "1", "]", "!"]);
    expect(out.join("")).toBe("Привет, Анна!");
    expect(out.some((piece) => piece.includes("[") || piece.includes("ИМ"))).toBe(false);
  });

  it("квадратная скобка не из метки: удерживается недолго и уходит как есть", () => {
    expect(
      run(["список [1] и ", "[это не метка и очень длинный хвост без закрытия"]).join(""),
    ).toBe("список [1] и [это не метка и очень длинный хвост без закрытия");
  });

  it("конец потока с недописанной меткой — остаток как есть", () => {
    expect(run(["до [ИМ"]).join("")).toBe("до [ИМ");
  });

  it("неизвестная метка остаётся меткой", () => {
    expect(run(["[ИМЯ_9]"]).join("")).toBe("[ИМЯ_9]");
  });

  it("для аргументов инструментов значение экранируется под JSON-строку", () => {
    expect(run(['{"to":"', "[СЧЁТ_", '1]"}'], jsonEscaped(map)).join("")).toBe(
      '{"to":"BY20 \\"тест\\""}',
    );
  });
});
