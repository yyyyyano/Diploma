// Реестр замен с коротким сроком жизни (PRIV-03, OBS-03): значения, которые маскировщик только что заменил метками,
// запоминаются на несколько минут, чтобы трассы Langfuse (спаны пишутся позже вызова) не получили их открытым текстом.
// Срок короткий намеренно: реестр — страховка для трасс, а не хранилище; в логи и ответы он не попадает.
export interface Redactions {
  remember(original: string, label: string): void;
  /** Заменить запомненные значения метками; длинные — первыми, чтобы «Иванова» не осталась хвостом «Иванов». */
  apply(text: string): string;
  readonly size: number;
}

/** Сколько живёт запись, мс: спан дописывается секунды спустя, минуты — с запасом. */
export const REDACTION_TTL_MS = 10 * 60_000;

export function createRedactions(now: () => number, ttlMs = REDACTION_TTL_MS): Redactions {
  const entries = new Map<string, { label: string; until: number }>();
  function prune(): void {
    const current = now();
    for (const [original, entry] of entries) if (entry.until <= current) entries.delete(original);
  }
  return {
    remember(original, label) {
      prune();
      if (original.length < 2) return;
      entries.set(original, { label, until: now() + ttlMs });
    },
    apply(text) {
      prune();
      let result = text;
      for (const [original, { label }] of [...entries].toSorted(
        (a, b) => b[0].length - a[0].length,
      )) {
        result = result.split(original).join(label);
      }
      return result;
    },
    get size() {
      prune();
      return entries.size;
    },
  };
}
