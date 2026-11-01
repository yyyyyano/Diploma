// Ссылка на норму (DES-06, design/DESIGN.md §4): «ст. 210 НК» — чип со значком закона; со ссылкой — настоящая `<a>`,
// внешняя (pravo.by) открывается в новой вкладке; с `onClick` — кнопка, раскрывающая цитату (DES-12, CHAT-05). Подпись
// всегда текстом: смысл не держится на одном цвете (NFR-20).
import { ExternalLink, Scale } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../cx.ts";
import classes from "./LawRefChip.module.css";

export interface LawRefChipProps {
  /** «ст. 210 НК» — готовая подпись. */
  readonly label: string;
  readonly href?: string;
  /** Ссылка ведёт на другой сайт (pravo.by): новая вкладка, `rel="noopener noreferrer"`, значок «внешняя». */
  readonly external?: boolean;
  /** Чип раскрывает цитату: кнопка вместо ссылки; `expanded` — раскрыта ли она сейчас. */
  readonly onClick?: () => void;
  readonly expanded?: boolean;
  /** Подпись для диктора, если она подробнее текста чипа («Показать цитату: ст. 210 НК»). */
  readonly ariaLabel?: string;
  /**
   * Для Popover.Target: он клонирует дочерний элемент, подмешивая ссылку, `id` и aria-атрибуты (`aria-haspopup`,
   * `aria-controls`) — на кнопке они допустимы, на обёртке-`span` axe их отвергает.
   */
  readonly ref?: Ref<HTMLButtonElement>;
  readonly id?: string;
  readonly className?: string;
  readonly "aria-haspopup"?: ButtonHTMLAttributes<HTMLButtonElement>["aria-haspopup"];
  readonly "aria-controls"?: string;
  readonly "aria-expanded"?: boolean;
}

export function LawRefChip({
  label,
  href,
  external = false,
  onClick,
  expanded,
  ariaLabel,
  ref,
  id,
  className,
  "aria-haspopup": haspopup,
  "aria-controls": controls,
  "aria-expanded": ariaExpanded,
}: LawRefChipProps) {
  const content = (
    <>
      <Scale size={14} strokeWidth={1.8} aria-hidden />
      {label}
      {external && <ExternalLink size={12} strokeWidth={1.8} aria-hidden />}
    </>
  );
  if (onClick !== undefined) {
    return (
      <button
        ref={ref}
        id={id}
        type="button"
        className={cx(classes.chip, className)}
        aria-haspopup={haspopup}
        aria-controls={controls}
        aria-expanded={ariaExpanded ?? expanded ?? false}
        {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  if (href === undefined) return <span className={classes.chip}>{content}</span>;
  return (
    <a
      className={classes.chip}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {content}
    </a>
  );
}
