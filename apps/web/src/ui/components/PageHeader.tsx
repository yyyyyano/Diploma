// Верхняя панель страницы (design/DESIGN.md §3, .k-top): заголовок страницы (единственный h1), подзаголовок,
// элементы страницы (период) и действия справа. Колокольчик и «Сканировать чек» каркаса встраивают их задачи
// (T-015, T-028) через actions.
import type { ReactNode } from "react";
import classes from "./PageHeader.module.css";

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: ReactNode;
  /** Элементы страницы между заголовком и действиями: переключатель периода. */
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}

export function PageHeader({ title, subtitle, children, actions }: PageHeaderProps) {
  return (
    <header className={classes.top}>
      <div className={classes.titleBlock}>
        <h1 className={classes.title}>{title}</h1>
        {subtitle !== undefined && <p className={classes.subtitle}>{subtitle}</p>}
      </div>
      {children}
      {actions !== undefined && <div className={classes.actions}>{actions}</div>}
    </header>
  );
}
