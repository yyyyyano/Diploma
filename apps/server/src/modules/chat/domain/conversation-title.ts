// CHAT-01: название диалога — первое сообщение, обрезанное по слову до 60 знаков, без модели (запрос на название
// стоил бы вызова облачной модели на пустом месте, а локальная отвечает медленно).
export const TITLE_MAX = 60;

/** «Сколько я потратил на кафе за лето и сколько сэкономлю…» → по границе слова, с «…», не длиннее 60 знаков. */
export function conversationTitle(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= TITLE_MAX) return flat;
  // Место под «…»: результат не длиннее TITLE_MAX.
  const head = flat.slice(0, TITLE_MAX - 1);
  const space = head.lastIndexOf(" ");
  const atWord = flat.charAt(TITLE_MAX - 1) === " " ? head : space > 0 ? head.slice(0, space) : "";
  // Первое слово длиннее 59 знаков (ссылка без пробелов): режем жёстко, лучше обрубок, чем пустое название.
  const cut = atWord.length >= 10 ? atWord : head;
  return `${cut.trimEnd()}…`;
}
