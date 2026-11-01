// TAX-20: получатель платежа — учреждение образования? Признаки (слова) берутся из настройки `tax.education-payee-words`, модель не
// участвует. Слово ищется с границы слова (сокращение «бгу» не находится внутри «технобгумага»); «ё» и «е», регистр не важны.
const normalize = (text: string): string => text.toLowerCase().replaceAll("ё", "е");

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export function isEducationPayee(
  texts: readonly (string | null)[],
  words: readonly string[],
): boolean {
  const haystack = texts.flatMap((text) => (text === null ? [] : [normalize(text)]));
  return words.some((word) => {
    const pattern = new RegExp(`(?<![\\p{L}\\d])${escape(normalize(word))}`, "u");
    return haystack.some((text) => pattern.test(text));
  });
}
