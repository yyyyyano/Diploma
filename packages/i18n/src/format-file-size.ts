// DES-17, PRIV-05: размер файла — «820 Б», «1,5 КБ», «18,4 МБ» (архив «Мои данные», позже — файлы чеков и выписок).
// Двоичные единицы (1 КБ = 1024 Б, как у проводника), десятые через запятую, «,0» не пишется; между числом и единицей
// неразрывный пробел. Без Intl — по той же причине, что formatMoney (разные пробелы в разных версиях ICU).
const NBSP = String.fromCharCode(0x00a0);
const UNITS = ["КБ", "МБ", "ГБ", "ТБ"] as const;

export function formatFileSize(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError(`Размер файла — целое число байт не меньше нуля, получено ${bytes}.`);
  }
  if (bytes < 1024) return `${bytes}${NBSP}Б`;
  let unit = 0;
  let tenths = Math.round((bytes * 10) / 1024);
  // 1023,96 КБ округляется до «1024 КБ» — это уже следующая единица.
  while (tenths >= 10_240 && unit < UNITS.length - 1) {
    unit += 1;
    tenths = Math.round((bytes * 10) / 1024 ** (unit + 1));
  }
  const whole = Math.floor(tenths / 10);
  const tenth = tenths % 10;
  return `${whole}${tenth === 0 ? "" : `,${tenth}`}${NBSP}${UNITS[unit]}`;
}
