// Правила округления (.claude/rules/calc.md): округление только явное, по правилу с шагом, и оба пишутся в трассу.
// Считается на BigInt — без float и без потери точности у границы безопасного диапазона.

/**
 * half-up — половина «от нуля», симметрично для отрицательных (−0,5 → −1, 0,5 → 1);
 * half-even — банковское, половина к чётному (0,5 → 0, 1,5 → 2, −0,5 → 0);
 * floor — к минус бесконечности; ceil — к плюс бесконечности.
 */
export type RoundingMode = "half-up" | "half-even" | "floor" | "ceil";

/** Шаг: kopeck — 1 минимальная единица валюты, ruble — 100 (у BYN, USD, EUR, RUB по две цифры после запятой). */
export type RoundingUnit = "kopeck" | "ruble";

/** Правило «режим-шаг»: `half-up-kopeck` — до копейки, половина от нуля. */
export type RoundingRule = `${RoundingMode}-${RoundingUnit}`;

interface RuleParts {
  readonly mode: RoundingMode;
  readonly step: bigint;
}

const RULES = {
  "half-up-kopeck": { mode: "half-up", step: 1n },
  "half-even-kopeck": { mode: "half-even", step: 1n },
  "floor-kopeck": { mode: "floor", step: 1n },
  "ceil-kopeck": { mode: "ceil", step: 1n },
  "half-up-ruble": { mode: "half-up", step: 100n },
  "half-even-ruble": { mode: "half-even", step: 100n },
  "floor-ruble": { mode: "floor", step: 100n },
  "ceil-ruble": { mode: "ceil", step: 100n },
} as const satisfies Record<RoundingRule, RuleParts>;

/** Пояснение для трассы: правило и шаг в минимальных единицах. */
export function roundingNote(rule: RoundingRule): string {
  return `rounding=${rule} step=${RULES[rule].step}`;
}

/** numerator / denominator, округлённое по правилу до его шага (результат — в минимальных единицах). */
export function divideRounded(numerator: bigint, denominator: bigint, rule: RoundingRule): bigint {
  const { mode, step } = RULES[rule];
  return divide(numerator, denominator * step, mode) * step;
}

/**
 * Целочисленное деление с округлением. Делитель всегда положителен: 10 000 × шаг, число слагаемых × шаг, шаг.
 * BigInt-деление отбрасывает дробь к нулю, остаток — со знаком делимого.
 */
function divide(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const away = numerator < 0n ? -1n : 1n; // направление «от нуля»: знак остатка совпадает со знаком делимого
  const twice = 2n * (remainder < 0n ? -remainder : remainder);
  switch (mode) {
    case "floor":
      return numerator < 0n ? quotient - 1n : quotient;
    case "ceil":
      return numerator > 0n ? quotient + 1n : quotient;
    case "half-up":
      return twice >= denominator ? quotient + away : quotient;
    case "half-even": {
      if (twice !== denominator) return twice > denominator ? quotient + away : quotient;
      return quotient % 2n === 0n ? quotient : quotient + away;
    }
  }
}
