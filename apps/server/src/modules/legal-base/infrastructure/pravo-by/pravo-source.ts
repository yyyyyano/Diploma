// LegalSource на pravo.by (LAW-03): страница текста акта — `https://pravo.by/document/?guid=3871&p0=<ID>`; все запросы
// идут через PoliteFetcher (одна очередь, robots, повторы). Карточки актов (guid=3961) — T-036.
import {
  ActTextNotFound,
  SourceUnavailable,
  type LegalSource,
  type SourcePage,
} from "../../application/ports.ts";
import type { PoliteFetcher } from "./polite-fetcher.ts";

/** ID актов pravo.by: буквы и цифры (`H10200090`); другое в адрес не подставляется. */
export const PRAVO_ID = /^[A-Za-z][A-Za-z0-9]{5,11}$/u;

export function textUrl(baseUrl: string, pravoId: string): URL {
  if (!PRAVO_ID.test(pravoId)) throw new RangeError("ID акта pravo.by не по правилу реквизитов.");
  return new URL(`/document/?guid=3871&p0=${pravoId}`, baseUrl);
}

export function createPravoSource(deps: {
  readonly fetcher: PoliteFetcher;
  readonly baseUrl: string;
}): LegalSource {
  return {
    async fetchActText(pravoId): Promise<SourcePage> {
      const got = await deps.fetcher.get(textUrl(deps.baseUrl, pravoId));
      if (got.status === 404) throw new ActTextNotFound();
      if (got.status !== 200) throw new SourceUnavailable();
      return { html: got.body, fetchedAt: got.fetchedAt };
    },
  };
}
