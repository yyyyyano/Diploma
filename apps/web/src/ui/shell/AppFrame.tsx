// Раскладка каркаса (design/DESIGN.md §3, .k-app/.k-main/.k-body): меню слева (≤ 860 px — сверху), содержимое до
// 1260 px; на телефоне снизу место под нижнюю панель.
import type { ReactNode } from "react";
import classes from "./AppFrame.module.css";

export interface AppFrameProps {
  readonly side: ReactNode;
  readonly bottom?: ReactNode;
  readonly children: ReactNode;
}

export function AppFrame({ side, bottom, children }: AppFrameProps) {
  return (
    <div className={classes.app}>
      {side}
      <main className={classes.main}>{children}</main>
      {bottom}
    </div>
  );
}
