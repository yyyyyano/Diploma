// Лимитёр и размыкатель бесплатных тарифов (LLM-05, ARCHITECTURE §8.1). Лимиты модели — запросы и токены в минуту
// и в сутки (rpm, tpm, rpd, tpd записи реестра). Окна считаются по журналу расхода (llm_usage общий для api и worker:
// после перезапуска лимитёр «помнит» расход, а чужой процесс виден), плюс запросы, ещё летящие в этом процессе, —
// иначе пачка параллельных вызовов проскочит лимит, пока журнал ждёт их конца. Заголовки x-ratelimit-* ответа
// провайдера уточняют остаток точнее журнала; 429 с retry-after размыкает модель в памяти процесса на указанное время.
// Состояние памяти — на процесс: после перезапуска окна восстановятся из журнала, а размыкатель — первым же 429.
import type { UsageWindows } from "../infrastructure/db/llm.repo.ts";
import type { RateLimits } from "../infrastructure/db/llm.repo.ts";
import { APICallError } from "@ai-sdk/provider";

/** Что остановило вызов: окно лимита тарифа, остаток по заголовкам или ожидание после 429. */
export type BlockKind = "rpm" | "tpm" | "rpd" | "tpd" | "headers" | "retry-after";

export interface LimitBlock {
  readonly kind: BlockKind;
}

/** Модель с точки зрения лимитёра: ключ журнала `<провайдер>/<модель>` и лимиты тарифа. */
export interface LimitedModel {
  /** Ключ реестра и журнала: `<провайдер>/<модель>`. */
  readonly id: string;
  readonly limits: RateLimits;
}

export interface LimiterDeps {
  readonly now: () => Date;
  /** Расход по журналу в окнах минуты и суток; зовётся только для моделей с опубликованными лимитами. */
  readonly usage: () => Promise<ReadonlyMap<string, UsageWindows>>;
}

interface HeaderWindow {
  remainingRequests?: number;
  requestsResetAt?: number;
  remainingTokens?: number;
  tokensResetAt?: number;
}

/** Ожидание по умолчанию, если провайдер ответил 429 без retry-after. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;
/** Дольше суток модель не размыкаем: retry-after больше — почти наверняка ошибка разбора. */
const MAX_RETRY_AFTER_MS = 86_400_000;

/** «1m26.4s», «2.085s», «250ms», «30» (секунды) → миллисекунды; не разобрано — undefined. */
export function parseDurationMs(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;
  let total = 0;
  let matched = 0;
  for (const match of trimmed.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(match[1]) * unit[match[2] as keyof typeof unit];
    matched += match[0].length;
  }
  return matched === trimmed.length && matched > 0 ? Math.round(total) : undefined;
}

function header(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found?.[1];
}

function count(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d+$/.test(text.trim())) return undefined;
  return Number(text);
}

export function createLimiter(d: LimiterDeps) {
  const brokenUntil = new Map<string, number>();
  const windows = new Map<string, HeaderWindow>();
  const inflight = new Map<string, { requests: number; tokens: number }>();

  async function check(model: LimitedModel, estimate: number): Promise<LimitBlock | undefined> {
    const now = d.now().getTime();
    const until = brokenUntil.get(model.id);
    if (until !== undefined) {
      if (until > now) return { kind: "retry-after" };
      brokenUntil.delete(model.id);
    }
    const fromHeaders = windows.get(model.id);
    if (fromHeaders !== undefined) {
      const { remainingRequests, requestsResetAt, remainingTokens, tokensResetAt } = fromHeaders;
      if (remainingRequests !== undefined && remainingRequests <= 0 && (requestsResetAt ?? 0) > now)
        return { kind: "headers" };
      if (remainingTokens !== undefined && estimate > remainingTokens && (tokensResetAt ?? 0) > now)
        return { kind: "headers" };
    }
    const { rpm, tpm, rpd, tpd } = model.limits;
    if (rpm === null && tpm === null && rpd === null && tpd === null) return undefined;
    const used = (await d.usage()).get(model.id);
    const flying = inflight.get(model.id) ?? { requests: 0, tokens: 0 };
    const requestsMinute = (used?.requestsMinute ?? 0) + flying.requests;
    const tokensMinute = (used?.tokensMinute ?? 0) + flying.tokens;
    const requestsDay = (used?.requestsDay ?? 0) + flying.requests;
    const tokensDay = (used?.tokensDay ?? 0) + flying.tokens;
    // Сначала суточные: «на сегодня всё» важнее «подождите минуту» (администратору — другое уведомление).
    if (rpd !== null && requestsDay + 1 > rpd) return { kind: "rpd" };
    if (tpd !== null && tokensDay + estimate > tpd) return { kind: "tpd" };
    if (rpm !== null && requestsMinute + 1 > rpm) return { kind: "rpm" };
    if (tpm !== null && tokensMinute + estimate > tpm) return { kind: "tpm" };
    return undefined;
  }

  /** Вызов пошёл: запрос и оценка токенов учитываются, пока журнал не получил строку. Возвращает «отпустить». */
  function reserve(id: string, estimate: number): () => void {
    const current = inflight.get(id) ?? { requests: 0, tokens: 0 };
    inflight.set(id, { requests: current.requests + 1, tokens: current.tokens + estimate });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const now = inflight.get(id) ?? { requests: 1, tokens: estimate };
      inflight.set(id, {
        requests: Math.max(0, now.requests - 1),
        tokens: Math.max(0, now.tokens - estimate),
      });
    };
  }

  /** Остаток из заголовков x-ratelimit-* успешного ответа: точнее журнала, пока окно не сбросилось. */
  function observe(id: string, headers: Readonly<Record<string, string>> | undefined): void {
    if (headers === undefined) return;
    const now = d.now().getTime();
    const remainingRequests = count(header(headers, "x-ratelimit-remaining-requests"));
    const remainingTokens = count(header(headers, "x-ratelimit-remaining-tokens"));
    if (remainingRequests === undefined && remainingTokens === undefined) return;
    const next: HeaderWindow = {};
    if (remainingRequests !== undefined) {
      next.remainingRequests = remainingRequests;
      next.requestsResetAt =
        now + (parseDurationMs(header(headers, "x-ratelimit-reset-requests")) ?? 0);
    }
    if (remainingTokens !== undefined) {
      next.remainingTokens = remainingTokens;
      next.tokensResetAt =
        now + (parseDurationMs(header(headers, "x-ratelimit-reset-tokens")) ?? 0);
    }
    windows.set(id, next);
  }

  /**
   * Ответ провайдера — ошибка. 429 размыкает модель на retry-after (или минуту); возвращает, был ли это 429
   * (администратору — уведомление «исчерпан лимит», а не «ошибка»).
   */
  function rejected(id: string, error: unknown): boolean {
    if (!APICallError.isInstance(error) || error.statusCode !== 429) return false;
    const wait =
      parseDurationMs(
        error.responseHeaders === undefined
          ? undefined
          : header(error.responseHeaders, "retry-after"),
      ) ?? DEFAULT_RETRY_AFTER_MS;
    brokenUntil.set(id, d.now().getTime() + Math.min(wait, MAX_RETRY_AFTER_MS));
    return true;
  }

  return { check, reserve, observe, rejected };
}

export type Limiter = ReturnType<typeof createLimiter>;
