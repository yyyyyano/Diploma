// Чтение карточки акта (`guid=3961`) одним вызовом (T-039, замечено в T-037): утрата силы и принятые изменения (act-check) и
// кандидаты из графа ссылок (catalog-growth) читают одну и ту же карточку — без общего чтения она уходила бы на pravo.by
// дважды за ночь. Короткий кэш в процессе worker: прочитанная карточка живёт `ttlMs` (по умолчанию 6 часов — ночной проход).
import type { Clock } from "@kosht/kernel";
import { parseCard, type ParsedCard } from "../infrastructure/pravo-by/parse-card.ts";
import type { RegistrySource } from "./ports.ts";

export const CARD_TTL_MS = 6 * 3_600_000;

export function makeCardReader(d: {
  readonly source: () => Promise<Pick<RegistrySource, "fetchActCard">>;
  readonly clock: Clock;
  readonly ttlMs?: number;
}) {
  const cache = new Map<string, { readonly at: number; readonly card: ParsedCard }>();
  return async function readCard(pravoId: string): Promise<ParsedCard> {
    const now = d.clock.now().getTime();
    const hit = cache.get(pravoId);
    if (hit !== undefined && now - hit.at < (d.ttlMs ?? CARD_TTL_MS)) return hit.card;
    const card = parseCard((await (await d.source()).fetchActCard(pravoId)).html);
    cache.set(pravoId, { at: now, card });
    return card;
  };
}

export type ReadCard = ReturnType<typeof makeCardReader>;
