// LegalSource на pravo.by (LAW-03): страница текста акта — `https://pravo.by/document/?guid=3871&p0=<ID>`; все запросы
// идут через PoliteFetcher (одна очередь, robots, повторы). Карточки актов (guid=3961) — T-036.
import {
  ActTextNotFound,
  SourceUnavailable,
  type AgencySource,
  type DiscoverySource,
  type LegalSource,
  type RegistrySource,
  type SourcePage,
} from "../../application/ports.ts";
import type { PoliteFetcher } from "./polite-fetcher.ts";

/** ID актов pravo.by: буквы и цифры (`H10200090`); другое в адрес не подставляется. */
export const PRAVO_ID = /^[A-Za-z][A-Za-z0-9]{5,11}$/u;

export function textUrl(baseUrl: string, pravoId: string): URL {
  if (!PRAVO_ID.test(pravoId)) throw new RangeError("ID акта pravo.by не по правилу реквизитов.");
  return new URL(`/document/?guid=3871&p0=${pravoId}`, baseUrl);
}

/** День в форме сайта: `29.10.2026`. */
function siteDay(day: string): string {
  const [year = "", month = "", date = ""] = day.split("-");
  return `${date}.${month}.${year}`;
}

export function createPravoSource(deps: {
  readonly fetcher: PoliteFetcher;
  readonly baseUrl: string;
}): LegalSource & RegistrySource & DiscoverySource {
  return {
    async fetchArrivals(day): Promise<SourcePage> {
      const url = new URL("/natsionalnyy-reestr/novye-postupleniya/", deps.baseUrl);
      url.searchParams.set("p0", siteDay(day));
      url.searchParams.set("p1", siteDay(day));
      const got = await deps.fetcher.get(url);
      if (got.status !== 200) throw new SourceUnavailable();
      return { html: got.body, fetchedAt: got.fetchedAt };
    },
    async fetchActRubrics(pravoId): Promise<SourcePage | null> {
      if (!PRAVO_ID.test(pravoId))
        throw new RangeError("ID акта pravo.by не по правилу реквизитов.");
      const got = await deps.fetcher.get(
        new URL(`/document/?guid=11031&p0=${pravoId}`, deps.baseUrl),
      );
      // Страница есть только у актов из тематических банков данных; остальным — переадресация или 404: рубрик нет.
      return got.status === 200 ? { html: got.body, fetchedAt: got.fetchedAt } : null;
    },
    async fetchActText(pravoId): Promise<SourcePage> {
      const got = await deps.fetcher.get(textUrl(deps.baseUrl, pravoId));
      if (got.status === 404) throw new ActTextNotFound();
      if (got.status !== 200) throw new SourceUnavailable();
      return { html: got.body, fetchedAt: got.fetchedAt };
    },
    async fetchActCard(pravoId): Promise<SourcePage> {
      if (!PRAVO_ID.test(pravoId))
        throw new RangeError("ID акта pravo.by не по правилу реквизитов.");
      const got = await deps.fetcher.get(
        new URL(`/document/?guid=3961&p0=${pravoId}`, deps.baseUrl),
      );
      if (got.status !== 200) throw new SourceUnavailable();
      return { html: got.body, fetchedAt: got.fetchedAt };
    },
    async headActText(pravoId) {
      const got = await deps.fetcher.head(textUrl(deps.baseUrl, pravoId));
      if (got.status === 404) throw new ActTextNotFound();
      if (got.status !== 200) throw new SourceUnavailable();
      return { contentLength: got.contentLength };
    },
  };
}

/**
 * Страницы ведомственных сайтов (LAW-15): для каждого хоста — свой PoliteFetcher (своя пауза, robots и остановка); текст с них
 * не берётся, только ссылки на pravo.by (LAW-03).
 */
export function createAgencySource(deps: {
  readonly fetcherFor: (host: string) => PoliteFetcher;
}): AgencySource {
  return {
    async fetchAgencyPage(url): Promise<SourcePage> {
      const target = new URL(url);
      if (target.protocol !== "https:" && target.protocol !== "http:") {
        throw new RangeError("Страница ведомства: только http и https.");
      }
      const got = await deps.fetcherFor(target.host).get(target);
      if (got.status !== 200) throw new SourceUnavailable();
      return { html: got.body, fetchedAt: got.fetchedAt };
    },
  };
}
