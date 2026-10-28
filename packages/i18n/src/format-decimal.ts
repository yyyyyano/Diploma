// Десятичная дробь из целого в долях (курс НБРБ 2,9871 хранится как 29871 десятитысячных): строка собирается из целых
// цифр, без float и Intl — запятая перед дробью, как в DES-17.
const MINUS = String.fromCharCode(0x2212);

/** `formatScaled(29871, 4)` → «2,9871»; `formatScaled(36432, 4)` → «3,6432». */
export function formatScaled(value: number, decimals: number): string {
  if (!Number.isSafeInteger(value) || !Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(
      `formatScaled: целое значение и число знаков, получено ${value}/${decimals}.`,
    );
  }
  const digits = Math.abs(value)
    .toString()
    .padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  const sign = value < 0 ? MINUS : "";
  return decimals === 0 ? `${sign}${whole}` : `${sign}${whole},${fraction}`;
}
