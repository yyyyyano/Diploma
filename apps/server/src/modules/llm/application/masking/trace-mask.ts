// Маска трасс Langfuse (PRIV-03, OBS-03, КП «в Langfuse текст замаскирован»): спаны AI SDK пишут запрос и ответ модели
// в том виде, в каком их видит SDK, — до маскирования на границе провайдера. Поэтому перед выгрузкой процессор Langfuse
// вызывает эту функцию — синхронно, по одному значению: (1) значения, которые маскировщик заменил в этом вызове
// (реестр замен, короткий срок жизни), заменяются теми же метками; (2) номера счетов, карты, телефоны, email и
// паспорта ловятся правилами без реестра — даже если значение пришло мимо маскировщика (результат инструмента,
// сообщение об ошибке). Структура значения (объекты, массивы, числа) сохраняется; ключи не трогаются.
import { LABEL_PREFIX } from "../../domain/masking/labels.ts";
import { detectByRules } from "../../domain/masking/rules.ts";
import type { Redactions } from "./redactions.ts";

/** Виды, которые ловятся правилами без реестра: имена и адреса без словаря и NER правилами не определить. */
const BY_RULES = new Set(["iban", "card", "phone", "email", "passport"]);

function maskString(text: string, redactions: Redactions): string {
  let result = redactions.apply(text);
  const spans = detectByRules(result)
    .filter((span) => BY_RULES.has(span.kind))
    .toSorted((a, b) => b.start - a.start);
  let last = Number.POSITIVE_INFINITY;
  for (const span of spans) {
    // Пересекающиеся отрезки: остаётся тот, что левее (правила щедрые, лишняя метка безвредна).
    if (span.end > last) continue;
    result = `${result.slice(0, span.start)}[${LABEL_PREFIX[span.kind]}]${result.slice(span.end)}`;
    last = span.start;
  }
  return result;
}

export function createTraceMask(redactions: Redactions) {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return maskString(value, redactions);
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    }
    return value;
  };
  return ({ data }: { data: unknown }): unknown => walk(data);
}
