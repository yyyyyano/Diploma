import { describe, expect, it } from "vitest";
import { scrub } from "./scrub.ts";

describe("OBS-04: scrub вычищает данные, узнаваемые по форме", () => {
  it("email — и латиницей, и кириллицей", () => {
    expect(scrub("нет пользователя ivan.petrov+bank@mail.example.by")).toBe(
      "нет пользователя [email]",
    );
    expect(scrub("адрес иван@почта.бел недоступен")).toBe("адрес [email] недоступен");
  });

  it("номер карты с верной контрольной суммой Луна — слитно, с пробелами и дефисами", () => {
    expect(scrub("карта 4111111111111111 отклонена")).toBe("карта [card] отклонена");
    expect(scrub("карта 4111 1111 1111 1111.")).toBe("карта [card].");
    expect(scrub("5500-0000-0000-0004")).toBe("[card]");
  });

  it("цифры без контрольной суммы Луна (id, метки времени) остаются", () => {
    expect(scrub("заказ 4111111111111112")).toBe("заказ 4111111111111112");
    expect(scrub("1761085800000 мс")).toBe("1761085800000 мс");
  });

  it("IBAN BY — слитно, группами и строчными буквами", () => {
    expect(scrub("счёт BY13NBRB3600900000002Z00AB00")).toBe("счёт [iban]");
    expect(scrub("BY13 NBRB 3600 9000 0000 2Z00 AB00 закрыт")).toBe("[iban] закрыт");
    expect(scrub("by13nbrb3600900000002z00ab00")).toBe("[iban]");
  });

  it("обычный текст не меняется", () => {
    expect(scrub("connection terminated unexpectedly")).toBe("connection terminated unexpectedly");
  });
});
