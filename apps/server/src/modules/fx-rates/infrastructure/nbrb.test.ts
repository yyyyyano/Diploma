// STMT-09: адаптер НБРБ на записанных ответах без сети (формат — SPEC §9.8, проверено 2026-10-12; значения курсов
// синтетические): адрес по ISO-коду и дню, масштаб RUB, 404 и пустой ответ — «курса нет», сбой и чужая валюта — ошибка.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createNbrbSource } from "./nbrb.ts";

const fixture = (name: string) =>
  readFile(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8");

function sourceWith(respond: (url: string) => Promise<Response>) {
  const urls: string[] = [];
  const source = createNbrbSource({
    timeoutMs: async () => 1000,
    fetch: async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      urls.push(url);
      return respond(url);
    },
  });
  return { source, urls };
}

describe("STMT-09: курс НБРБ по ISO-коду", () => {
  it("USD на 21.10.2026: запрос по коду и дню, курс в десятитысячных", async () => {
    const body = await fixture("nbrb-usd-2026-10-21");
    const { source, urls } = sourceWith(async () => new Response(body, { status: 200 }));
    expect(await source.rateOn("USD", "2026-10-21")).toEqual({
      currency: "USD",
      rateDate: "2026-10-21",
      rateE4: 29_871,
      scale: 1,
    });
    expect(urls).toEqual(["https://api.nbrb.by/exrates/rates/USD?parammode=2&ondate=2026-10-21"]);
  });

  it("RUB — курс за 100 единиц (Cur_Scale)", async () => {
    const body = await fixture("nbrb-rub-2026-10-21");
    const { source } = sourceWith(async () => new Response(body, { status: 200 }));
    expect(await source.rateOn("RUB", "2026-10-21")).toMatchObject({ rateE4: 36_432, scale: 100 });
  });

  it("404 и пустой ответ — курса на этот день нет", async () => {
    expect(
      await sourceWith(async () => new Response("", { status: 404 })).source.rateOn(
        "USD",
        "2026-10-25",
      ),
    ).toBeNull();
    expect(
      await sourceWith(async () => new Response("", { status: 200 })).source.rateOn(
        "USD",
        "2026-10-25",
      ),
    ).toBeNull();
  });

  it("сбой сервера, чужая валюта, ответ не по формату — ошибка", async () => {
    const usd = await fixture("nbrb-usd-2026-10-21");
    await expect(
      sourceWith(async () => new Response("", { status: 503 })).source.rateOn("USD", "2026-10-21"),
    ).rejects.toThrow("НБРБ ответил 503.");
    await expect(
      sourceWith(async () => new Response(usd, { status: 200 })).source.rateOn("EUR", "2026-10-21"),
    ).rejects.toThrow("НБРБ: курс другой валюты.");
    await expect(
      sourceWith(async () => new Response('{"x":1}', { status: 200 })).source.rateOn(
        "USD",
        "2026-10-21",
      ),
    ).rejects.toThrow("НБРБ: ответ не по формату.");
    const tooPrecise = usd.replace("2.9871", "2.98712");
    await expect(
      sourceWith(async () => new Response(tooPrecise, { status: 200 })).source.rateOn(
        "USD",
        "2026-10-21",
      ),
    ).rejects.toThrow("НБРБ: курс не по формату.");
  });
});
