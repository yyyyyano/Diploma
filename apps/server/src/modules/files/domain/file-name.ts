// Имя файла (SEC-03, ARCHITECTURE §6.6): из запроса приходит только как метаданные — для показа и имени при
// скачивании. В путь хранилища оно не попадает никогда (путь — id), но и в заголовок Content-Disposition, и в архив
// «Мои данные» уходит очищенным: без каталогов, управляющих символов и знаков, запрещённых в именах файлов.

/** Предел длины имени: хватает для «Выписка Беларусбанк 2026-10.pdf» и не раздувает заголовки. */
export const FILE_NAME_MAX = 120;

/** Знаки, запрещённые в именах файлов Windows и опасные в заголовках. */
const FORBIDDEN = new Set(["<", ">", ":", '"', "|", "?", "*"]);

/** Управляющий символ (код < 32 или DEL) или запрещённый знак → «_». */
function clean(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f || FORBIDDEN.has(char) ? "_" : char;
}

export function safeFileName(name: string): string {
  const base = Array.from(name.split(/[/\\]/).at(-1) ?? "", clean)
    .join("")
    .trim();
  if (base.replace(/\./g, "") === "") return "file";
  if (base.length <= FILE_NAME_MAX) return base;
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, FILE_NAME_MAX - extension.length) + extension;
}
