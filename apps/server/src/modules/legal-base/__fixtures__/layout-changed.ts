// Копия сохранённой страницы с «изменившейся вёрсткой» (LAW-39): абзацы `<p>` стали блоками `<div>`, как после
// редизайна pravo.by. Текст на месте, а структуры для разборщика нет — снимок должен уйти в карантин.
export function withChangedLayout(html: string): string {
  return html.replace(/<p(?=[\s>])/gu, "<div").replace(/<\/p>/gu, "</div>");
}
