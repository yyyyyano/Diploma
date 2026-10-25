// Пункты каркаса глазами дизайн-системы: подписи и адреса уже готовы, ui только рисует (откуда пункты — app).
import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";

export interface ShellNavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
}

export interface ShellNavGroup {
  readonly key: string;
  /** Подпись группы («Деньги»); у первой группы (Главная, Ассистент) её нет. */
  readonly label?: string;
  readonly items: readonly ShellNavItem[];
}

export interface ShellUser {
  readonly name: string;
  readonly email: string;
}

/**
 * Переход по ссылке каркаса: app ведёт его роутером без перезагрузки страницы. Клик с модификатором (новая
 * вкладка) и средней кнопкой браузер обрабатывает сам — обработчик его не получает.
 */
export type NavigateHandler = (href: string, event: MouseEvent<HTMLAnchorElement>) => void;

export function followLink(onNavigate: NavigateHandler | undefined, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (onNavigate === undefined || modified || event.button !== 0) return;
    onNavigate(href, event);
  };
}
