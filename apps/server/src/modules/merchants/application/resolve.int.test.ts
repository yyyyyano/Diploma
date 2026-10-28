// STMT-06, CAT-03, TXN-10 на Postgres со справочником из миграции: «OOO EVROTORG T-0042 MINSK UL…» → «Евроопт» с
// категорией справочника; опечатка в алиасе находится по pg_trgm; незнакомое — название с заглавных без категории;
// похожесть названий — fuzzball с порогом настройки.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { makeResolve } from "./resolve.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

function resolver(aliasSimilarity = 0.6, nameSimilarity = 85) {
  return makeResolve({
    system: createSystemDb(db.pool),
    settings: {
      get: async (def) =>
        (def.key === "merchants.alias-similarity" ? aliasSimilarity : nameSimilarity) as never,
    },
  });
}

describe("STMT-06: очистка названий и справочник РБ", () => {
  it("«OOO EVROTORG T-0042 MINSK UL…» → «Евроопт», категория справочника, исходное описание сохранено", async () => {
    const raw = "OOO EVROTORG T-0042 MINSK UL. LENINA 12";
    expect(await resolver().resolve([raw])).toEqual([
      {
        original: raw,
        key: "EVROTORG",
        name: "Евроопт",
        merchantId: expect.any(String),
        categoryCode: "groceries",
        mcc: null,
      },
    ]);
  });

  it("пачка в том же порядке: по первому слову, по pg_trgm с опечаткой, незнакомое и пустое", async () => {
    const [santa, typo, unknown, noise] = await resolver().resolve([
      "POKUPKA SANTA RETAIL GRODNO",
      "BELORUSNEFTT AZS 45",
      "Оплата ТАКСИ 7788 MCC 4121",
      "POS 123456",
    ]);
    expect(santa).toMatchObject({ name: "Санта", categoryCode: "groceries" });
    expect(typo).toMatchObject({ name: "Белоруснефть", categoryCode: "car" });
    expect(unknown).toMatchObject({
      key: "ТАКСИ",
      name: "Такси",
      merchantId: null,
      categoryCode: null,
      mcc: "4121",
    });
    expect(noise).toMatchObject({ key: "", name: "", merchantId: null });
  });

  it("порог pg_trgm — настройка: строже — опечатка не узнана", async () => {
    const [typo] = await resolver(0.95).resolve(["BELORUSNEFTT AZS 45"]);
    expect(typo).toMatchObject({ merchantId: null, name: "Belorusneftt Azs" });
  });
});

describe("TXN-10: похожесть названий", () => {
  it("тот же магазин с шумом — похожи; разные — нет; порог — настройка", async () => {
    const r = resolver();
    expect(r.similarity("OOO EVROTORG T-0042 MINSK", "EVROTORG")).toBe(100);
    expect(await r.isSameMerchant("SANTA RETAIL 15", "SANTA")).toBe(true);
    expect(await r.isSameMerchant("SANTA", "GIPPO")).toBe(false);
    expect(await r.isSameMerchant("SANTA", "SANTAA")).toBe(true);
    expect(await resolver(0.6, 100).isSameMerchant("SANTA", "SANTAA")).toBe(false);
  });

  it("RCPT-15: нормализация позиций — та же, что в domain", () => {
    expect(resolver().normalizeItemName("Молоко 3,2% 1л")).toBe("Молоко");
  });
});
