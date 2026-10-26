// Письмо системы (AUTH-03, AUTH-04, AUTH-06): готовые тексты из словаря mail и одна кнопка-ссылка. Форма одна для
// SMTP и локального ящика: SMTP получает текст и HTML отсюда, ящик хранит поля как есть и рисует их сам — без
// HTML в базе и без вставки разметки на сайте. Значения экранируются здесь (ссылка — только http/https).

/** Пометка под кнопкой: info — справка, warn — предупреждение (макет Mailbox.dc.html). */
export type MailNoteKind = "info" | "warn";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Строка-превью в списке писем. */
  readonly preview: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly action?: { readonly label: string; readonly url: string };
  readonly note?: { readonly kind: MailNoteKind; readonly text: string };
}

/** Письмо локального ящика: то же письмо с id и моментом отправки. */
export interface StoredMail extends MailMessage {
  readonly id: string;
  readonly sentAt: Date;
}

/** Ссылка письма — только http(s): javascript: и прочее в письмо не попадает. */
export function isSafeLink(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol } = new URL(url);
  return protocol === "http:" || protocol === "https:";
}

/** Текстовая часть письма: заголовок, абзацы, ссылка отдельной строкой, пометка. */
export function renderText(message: MailMessage): string {
  const parts = [message.title, ...message.paragraphs];
  if (message.action !== undefined) parts.push(`${message.action.label}: ${message.action.url}`);
  if (message.note !== undefined) parts.push(message.note.text);
  return `${parts.join("\n\n")}\n`;
}

const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/** HTML-часть письма: простая разметка без стилей и картинок, каждое значение экранировано. */
export function renderHtml(message: MailMessage): string {
  const body = [
    `<h1>${escapeHtml(message.title)}</h1>`,
    ...message.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
  ];
  if (message.action !== undefined) {
    const href = escapeHtml(message.action.url);
    body.push(`<p><a href="${href}">${escapeHtml(message.action.label)}</a></p>`, `<p>${href}</p>`);
  }
  if (message.note !== undefined)
    body.push(`<p><small>${escapeHtml(message.note.text)}</small></p>`);
  return `<!doctype html><html lang="ru"><body>${body.join("")}</body></html>`;
}
