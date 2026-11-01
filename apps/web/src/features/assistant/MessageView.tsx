// Сообщение ленты (DES-10, DES-11, CHAT-02, CHAT-04): вопрос — тёмный пузырь справа; ответ — слева, на подложке `--surface-2`
// с аватаром. Ответ — части по порядку: текст модели (безопасный Markdown, SEC-05), шаг агента подписью из словаря
// tools по имени инструмента (не текстом модели), карточки и правовой ответ по реестру частей (`cards/registry.tsx`).
// Над правовым ответом — «Статья изменилась после ответа» (CHAT-10); под ответом — пометка «Модель X недоступна, ответила
// Y» (LLM-10) и состояние: «ещё отвечает» / «прерван».
import { resources } from "@kosht/i18n";
import { Button, VisuallyHidden } from "@mantine/core";
import type { UIMessage } from "ai";
import { CheckCircle2, Info, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DATA_CARDS, isDataCard, TOOL_CARDS } from "./cards/registry.tsx";
import { Unavailable } from "./cards/Unavailable.tsx";
import { Markdown } from "./Markdown.tsx";
import classes from "./MessageView.module.css";
import { metadataOf } from "./model/messages.ts";
import { StatusBadge } from "../../ui/index.ts";

const toolLabels = resources.ru.tools;
type ToolKey = keyof typeof toolLabels;

/** Подпись шага по имени инструмента; инструмента нет в словаре — запасная (`tools:fallback`). */
function toolKey(name: string): ToolKey {
  return Object.hasOwn(toolLabels, name) ? (name as ToolKey) : "fallback";
}

export function textOf(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

export interface MessageViewProps {
  readonly message: UIMessage;
  /** «Спросить заново» под ответом, где статья изменилась (CHAT-10): вопрос возвращается в поле ввода. */
  readonly onReask?: (() => void) | undefined;
}

export function MessageView({ message, onReask }: MessageViewProps) {
  const { t } = useTranslation(["assistant", "tools"]);
  if (message.role === "user") {
    // Сообщение из одних вложений текста не имеет: пузырь не пустой, диктор слышит, что было отправлено.
    const text = textOf(message);
    return (
      <div className={classes.user}>
        <VisuallyHidden>{t("you")}</VisuallyHidden>
        <p className={classes.bubble}>{text === "" ? t("attach.only") : text}</p>
      </div>
    );
  }
  const meta = metadataOf(message);
  const streaming = meta.status === "streaming";
  const interrupted = meta.status === "interrupted";
  const unavailable = meta.answeredBy?.unavailable ?? [];
  const changed = (meta.changedVersionIds ?? []).length > 0;
  return (
    <article className={classes.answer} aria-label={t("bot")}>
      <span className={classes.avatar}>
        <Sparkles size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className={classes.parts}>
        {changed && (
          <div className={classes.changed}>
            <StatusBadge tone="warn" icon={TriangleAlert}>
              {t("law.changed")}
            </StatusBadge>
            <span className={classes.muted}>{t("law.changedHint")}</span>
            {onReask !== undefined && (
              <Button variant="default" size="xs" onClick={onReask}>
                {t("law.reask")}
              </Button>
            )}
          </div>
        )}
        {message.parts.map((part, index) => (
          <Part key={`${message.id}-${String(index)}`} part={part} messageId={message.id} />
        ))}
        {streaming && (
          <p className={classes.muted}>
            <Loader2 className={classes.spin} size={16} strokeWidth={1.8} aria-hidden />
            {t("stillAnswering")}
          </p>
        )}
        {interrupted && <p className={classes.muted}>{t("interrupted")}</p>}
        {meta.answeredBy !== undefined && unavailable.length > 0 && (
          <p className={classes.muted}>
            <Info size={16} strokeWidth={1.8} aria-hidden />
            {t("answeredBy", {
              count: unavailable.length,
              unavailable: unavailable.join(", "),
              model: meta.answeredBy.model,
            })}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * Часть ответа по реестру (`cards/registry.tsx`). Шаг остаётся в ленте подписью из словаря (CHAT-02: видно, что агент
 * делал) — с вращающимся значком, пока идёт, и галочкой после; результат инструмента с карточкой рисует она, ошибка шага —
 * «Шаг не удался». Данные-часть — своя карточка; неизвестный вид `data-…` — запасной вид, а не пустота и не падение.
 */
function Part({
  part,
  messageId,
}: {
  readonly part: UIMessage["parts"][number];
  readonly messageId: string;
}) {
  const { t } = useTranslation(["assistant", "tools"]);
  if (part.type === "text") return part.text === "" ? null : <Markdown>{part.text}</Markdown>;
  if (part.type.startsWith("data-")) {
    if (!isDataCard(part.type)) return <Unavailable />;
    const Card = DATA_CARDS[part.type];
    return <Card data={"data" in part ? part.data : undefined} />;
  }
  if (!part.type.startsWith("tool-") || !("state" in part)) return null;
  const name = part.type.slice("tool-".length);
  const label = t(`tools:${toolKey(name)}`);
  const done = part.state === "output-available" || part.state === "output-error";
  const output = part.state === "output-available" && "output" in part ? part.output : undefined;
  const failed = part.state === "output-error" || (output !== undefined && isFailure(output));
  const Card = output !== undefined && !failed ? TOOL_CARDS[name] : undefined;
  return (
    <>
      <p className={classes.step}>
        {done ? (
          <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden />
        ) : (
          <Loader2 className={classes.spin} size={16} strokeWidth={1.8} aria-hidden />
        )}
        {label}
      </p>
      {Card !== undefined && <Card output={output} messageId={messageId} />}
      {failed && <p className={classes.muted}>{t("toolFailed")}</p>}
    </>
  );
}

function isFailure(output: unknown): boolean {
  return typeof output === "object" && output !== null && "ok" in output && output.ok === false;
}
