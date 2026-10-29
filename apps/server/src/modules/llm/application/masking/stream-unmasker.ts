// Демаскирование потока (PRIV-03): метка может прийти кусками («[ИМ», «Я_1]») — недописанный хвост держится в буфере,
// пока метка не закроется или не станет ясно, что это не метка. Для аргументов инструментов значение подставляется
// экранированным под JSON-строку: оно попадает внутрь `"…"`.
import { LABEL_PATTERN, MAX_LABEL_LENGTH } from "../../domain/masking/labels.ts";

export type Replace = (label: string) => string;

/** Подстановка значения внутрь строки JSON: кавычки, обратная косая и переводы строк экранируются. */
export const jsonEscaped =
  (replacements: ReadonlyMap<string, string>): Replace =>
  (found) => {
    const original = replacements.get(found);
    return original === undefined ? found : JSON.stringify(original).slice(1, -1);
  };

export const plain =
  (replacements: ReadonlyMap<string, string>): Replace =>
  (found) =>
    replacements.get(found) ?? found;

/** Индекс, с которого текст держится в буфере: недописанная метка в конце; нет такой — длина текста. */
function holdFrom(text: string): number {
  const open = text.lastIndexOf("[");
  if (open === -1) return text.length;
  if (text.indexOf("]", open) !== -1) return text.length;
  return text.length - open > MAX_LABEL_LENGTH ? text.length : open;
}

export function createStreamUnmasker(replace: Replace) {
  let pending = "";
  const unmask = (text: string) => text.replace(LABEL_PATTERN, replace);
  return {
    /** Кусок потока → то, что можно отдавать сейчас. */
    push(chunk: string): string {
      const text = pending + chunk;
      const hold = holdFrom(text);
      pending = text.slice(hold);
      return unmask(text.slice(0, hold));
    },
    /** Конец блока: остаток отдаётся как есть (недописанная метка — обычный текст). */
    flush(): string {
      const rest = pending;
      pending = "";
      return unmask(rest);
    },
  };
}
