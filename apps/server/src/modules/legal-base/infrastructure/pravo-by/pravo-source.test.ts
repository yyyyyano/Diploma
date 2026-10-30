// LAW-12, LAW-14, LAW-15: адреса новых источников — «Новые поступления» за день, рубрики ЕПК, страницы ведомств (на хост свой загрузчик).
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { SourceUnavailable } from "../../application/ports.ts";
import type { PoliteFetcher } from "./polite-fetcher.ts";
import { createAgencySource, createPravoSource } from "./pravo-source.ts";

function fakeFetcher(status: number, calls: string[]): PoliteFetcher {
  return {
    get: async (url: URL) => {
      calls.push(url.href);
      return {
        status,
        body: "<html></html>",
        fetchedAt: new Date("2026-10-31T01:00:00Z"),
        contentLength: null,
      };
    },
    head: async () => ({ status, body: "", fetchedAt: new Date(), contentLength: 1 }),
  };
}

describe("LAW-12: «Новые поступления» за день", () => {
  it("запрашивает день в форме сайта: p0 и p1 — ДД.ММ.ГГГГ", async () => {
    const calls: string[] = [];
    const source = createPravoSource({
      fetcher: fakeFetcher(200, calls),
      baseUrl: "https://pravo.by",
    });
    await source.fetchArrivals(LocalDate.parse("2026-10-29"));
    expect(calls).toEqual([
      "https://pravo.by/natsionalnyy-reestr/novye-postupleniya/?p0=29.10.2026&p1=29.10.2026",
    ]);
  });

  it("не 200 — источник недоступен: день не помечается обработанным", async () => {
    const source = createPravoSource({
      fetcher: fakeFetcher(503, []),
      baseUrl: "https://pravo.by",
    });
    await expect(source.fetchArrivals(LocalDate.parse("2026-10-29"))).rejects.toBeInstanceOf(
      SourceUnavailable,
    );
  });
});

describe("LAW-14: рубрики ЕПК", () => {
  it("страница guid=11031 акта; переадресация или 404 — рубрик нет", async () => {
    const calls: string[] = [];
    const ok = createPravoSource({ fetcher: fakeFetcher(200, calls), baseUrl: "https://pravo.by" });
    expect(await ok.fetchActRubrics("H10200090")).not.toBeNull();
    expect(calls).toEqual(["https://pravo.by/document/?guid=11031&p0=H10200090"]);
    const none = createPravoSource({ fetcher: fakeFetcher(302, []), baseUrl: "https://pravo.by" });
    expect(await none.fetchActRubrics("W22645348")).toBeNull();
  });
});

describe("LAW-15: страницы ведомств", () => {
  it("каждый хост читается своим загрузчиком (пауза и robots — отдельно на хост)", async () => {
    const hosts: string[] = [];
    const source = createAgencySource({
      fetcherFor: (host) => {
        hosts.push(host);
        return fakeFetcher(200, []);
      },
    });
    await source.fetchAgencyPage("https://www.nalog.gov.by/ru/zakon/");
    await source.fetchAgencyPage("https://nbrb.by/legislation");
    expect(hosts).toEqual(["www.nalog.gov.by", "nbrb.by"]);
  });

  it("адрес не http и не https не читается", async () => {
    const source = createAgencySource({ fetcherFor: () => fakeFetcher(200, []) });
    await expect(source.fetchAgencyPage("file:///etc/passwd")).rejects.toBeInstanceOf(RangeError);
  });
});
