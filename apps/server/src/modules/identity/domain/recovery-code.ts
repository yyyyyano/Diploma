// Код восстановления (AUTH-05): 16 знаков Crockford base32 (80 бит) группами «XXXX-XXXX-XXXX-XXXX». Алфавит без I, L,
// O, U — их не перепутать при переписывании с бумаги; ввод нормализуется: регистр, пробелы и дефисы не важны, «O» —
// это ноль, «I» и «L» — единица. Случайные байты — входом: domain не знает источника случайности.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_LENGTH = 16;
const CODE = new RegExp(`^[${ALPHABET}]{${String(RECOVERY_CODE_LENGTH)}}$`);

/** Код из 10 случайных байт (80 бит): каждые 5 бит — знак алфавита. */
export function formatRecoveryCode(random: Uint8Array): string {
  if (random.length !== 10) throw new RangeError("Нужно ровно 10 случайных байт.");
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of random) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)?.join("-") ?? out;
}

/** Введённый код без оформления; не код — undefined. */
export function normalizeRecoveryCode(input: string): string | undefined {
  const plain = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return CODE.test(plain) ? plain : undefined;
}
