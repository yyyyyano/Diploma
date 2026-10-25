// Условная стоимость вызова для журнала расхода (LLM-06, ADM-20): токены × цена записи реестра. Цена — в
// микродолларах за миллион токенов, результат — целые микродоллары (округление вверх: недооценивать расход нельзя).
// Это служебная метрика админки, а не деньги пользователя (P1 о них).

export interface Price {
  /** Микродолларов за 1 000 000 входных токенов. */
  readonly inputMicrosPerMillion: number;
  readonly outputMicrosPerMillion: number;
}

export function costMicros(tokens: { input: number; output: number }, price: Price): number {
  const total =
    tokens.input * price.inputMicrosPerMillion + tokens.output * price.outputMicrosPerMillion;
  return Math.ceil(total / 1_000_000);
}
