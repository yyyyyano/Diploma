// Сообщение ленты (DES-10, DES-11, CHAT-02): вопрос — тёмный пузырь справа; ответ — слева, на подложке `--surface-2` с
// аватаром. Ответ — части по порядку: текст модели (безопасный Markdown, SEC-05), шаг агента подписью из словаря
// tools по имени инструмента (не текстом модели), карточки счетов, правовой ответ целиком. Под ответом — пометка
// «Модель X недоступна, ответила Y» (LLM-10) и состояние: «ещё отвечает» / «прерван».
import { LawAnswerData, type AccountListItem } from "@kosht/contract";
import { resources } from "@kosht/i18n";
import { VisuallyHidden } from "@mantine/core";
import type { UIMessage } from "ai";
import { CheckCircle2, Info, Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountCard } from "../../entities/account/index.ts";
import { Markdown } from "./Markdown.tsx";
import classes from "./MessageView.module.css";
import { metadataOf } from "./model/messages.ts";

const toolLabels = resources.ru.tools;
type ToolKey = keyof typeof toolLabels;

/** Подпись шага по имени инструмента; инструмента нет в словаре — запасная (`tools:fallback`). */
function toolKey(name: string): ToolKey {
  return Object.hasOwn(toolLabels, name) ? (name as ToolKey) : "fallback";
}

export function textOf(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

export function MessageView({ message }: { readonly message: UIMessage }) {
  const { t } = useTranslation(["assistant", "tools"]);
  if (message.role === "user") {
    return (
      <div className={classes.user}>
        <VisuallyHidden>{t("you")}</VisuallyHidden>
        <p className={classes.bubble}>{textOf(message)}</p>
      </div>
    );
  }
  const meta = metadataOf(message);
  const streaming = meta.status === "streaming";
  const interrupted = meta.status === "interrupted";
  const unavailable = meta.answeredBy?.unavailable ?? [];
  return (
    <article className={classes.answer} aria-label={t("bot")}>
      <span className={classes.avatar}>
        <Sparkles size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className={classes.parts}>
        {message.parts.map((part, index) => (
          <Part key={`${message.id}-${String(index)}`} part={part} />
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
 * Часть ответа. Шаг остаётся в ленте подписью из словаря (CHAT-02: видно, что агент делал) — с вращающимся значком,
 * пока идёт, и галочкой после; результат list_accounts — карточки счетов, ошибка шага — «Шаг не удался». Правовой
 * ответ (`data-law-answer`) рисуется текстом по частям: цитаты и чипы статей — T-044.
 */
function Part({ part }: { readonly part: UIMessage["parts"][number] }) {
  const { t } = useTranslation(["assistant", "tools"]);
  if (part.type === "text") return part.text === "" ? null : <Markdown>{part.text}</Markdown>;
  if (part.type === "data-law-answer") return <LawAnswerFallback data={part.data} />;
  if (!part.type.startsWith("tool-") || !("state" in part)) return null;
  const label = t(`tools:${toolKey(part.type.slice("tool-".length))}`);
  const done = part.state === "output-available" || part.state === "output-error";
  const items = part.state === "output-available" ? accountsOf(part.output) : undefined;
  const failed =
    part.state === "output-error" || (part.state === "output-available" && isFailure(part.output));
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
      {items !== undefined && (
        <div className={classes.cards}>
          {items.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      )}
      {failed && <p className={classes.muted}>{t("toolFailed")}</p>}
    </>
  );
}

/** Правовой ответ без оформления: текст целиком и пометки — чтобы ответ не терялся до карточек цитат (T-044). */
function LawAnswerFallback({ data }: { readonly data: unknown }) {
  const parsed = LawAnswerData.safeParse(data);
  if (!parsed.success) return null;
  const text = parsed.data.parts
    .map((part) => (part.type === "text" ? part.text : `[${String(part.n)}]`))
    .join("");
  return (
    <>
      {text !== "" && <Markdown>{text}</Markdown>}
      {parsed.data.notices.map((notice) => (
        <p key={`${notice.kind}-${notice.text}`} className={classes.muted}>
          {notice.text}
        </p>
      ))}
    </>
  );
}

/** Результат list_accounts — { items: AccountListItem[] } (карточка из @kosht/contract). */
function accountsOf(output: unknown): AccountListItem[] | undefined {
  if (typeof output !== "object" || output === null || !("items" in output)) return undefined;
  const { items } = output;
  return Array.isArray(items) ? (items as AccountListItem[]) : undefined;
}

function isFailure(output: unknown): boolean {
  return typeof output === "object" && output !== null && "ok" in output && output.ok === false;
}
