// STMT-09, EXPL-01: эквивалент в BYN по официальному курсу НБРБ. Курс НБРБ — за Cur_Scale единиц валюты (RUB — за 100)
// с четырьмя знаками: в трассе он целым в десятитысячных (2,9871 → 29871) рядом с масштабом и ссылкой на сам курс
// (дата и валюта — у курса), сумма — до копейки, половина от нуля. BYN не пересчитывается.
import { Money } from "@kosht/kernel";
import { node, trace, type Calc } from "../calc.ts";
import { divideRounded, roundingNote } from "../rounding.ts";

/** Курс НБРБ: BYN за `scale` единиц валюты, в десятитысячных (2,9871 → 29871). */
export interface FxRateInput {
  readonly currency: string;
  readonly rateE4: number;
  readonly scale: number;
  /** Ссылка на курс в трассе (id строки кэша курсов). */
  readonly id: string;
}

const E4 = 10_000n;

/** STMT-09: сумма в валюте → BYN = сумма × курс ÷ масштаб, до копейки; валюта суммы — валюта курса. */
export function toByn(key: string, amount: Calc<Money>, rate: FxRateInput): Calc<Money> {
  if (amount.value.currency === "BYN") return amount;
  if (amount.value.currency !== rate.currency) {
    throw new RangeError(
      `${key}: курс ${rate.currency} к сумме в ${amount.value.currency} не применяется.`,
    );
  }
  if (
    !Number.isSafeInteger(rate.rateE4) ||
    rate.rateE4 <= 0 ||
    !Number.isSafeInteger(rate.scale) ||
    rate.scale <= 0
  ) {
    throw new RangeError(`${key}: курс и масштаб — целые больше нуля.`);
  }
  const rateNode = node("fx.rate", rate.rateE4, { refs: [{ kind: "fxRate", id: rate.id }] });
  const scaleNode = node("fx.scale", rate.scale);
  const rule = "half-up-kopeck" as const;
  const minor = divideRounded(
    BigInt(amount.value.minor) * BigInt(rate.rateE4),
    BigInt(rate.scale) * E4,
    rule,
  );
  const value = Money.of(Number(minor), "BYN");
  return {
    value,
    trace: trace(
      key,
      "mul",
      value,
      [amount.trace, rateNode.trace, scaleNode.trace],
      [],
      roundingNote(rule),
    ),
  };
}
