// Раскладка каркаса (design/DESIGN.md §3, .k-app/.k-main/.k-body): меню слева (≤ 860 px — сверху), содержимое до
// 1260 px; на телефоне снизу место под нижнюю панель.
import type { ReactNode } from "react";
import classes from "./AppFrame.module.css";

export interface AppFrameProps {
  readonly side: ReactNode;
  readonly bottom?: ReactNode;
  /**
   * Угол верхней панели страницы (колокольчик уведомлений, T-015): справа сверху над заголовком любой страницы;
   * заголовок страницы оставляет под него место (--k-corner в PageHeader).
   */
  readonly corner?: ReactNode;
  readonly children: ReactNode;
}

export function AppFrame({ side, bottom, corner, children }: AppFrameProps) {
  return (
    <div className={classes.app}>
      {side}
      <main
        className={corner === undefined ? classes.main : `${classes.main} ${classes.withCorner}`}
      >
        {corner !== undefined && <div className={classes.corner}>{corner}</div>}
        {children}
      </main>
      {bottom}
    </div>
  );
}
