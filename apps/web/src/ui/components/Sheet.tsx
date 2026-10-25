// Боковая панель (design/DESIGN.md §4 .sheet): справа, 460 px — объяснение числа, карточка операции, чат; на
// телефоне — снизу. Mantine Drawer: фокус внутри, Esc и клик по фону закрывают и возвращают фокус (NFR-20).
import { Drawer } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./Sheet.module.css";

export interface SheetProps {
  readonly opened: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly children: ReactNode;
  /** bottom — шторка снизу (телефон). */
  readonly position?: "right" | "bottom";
}

export function Sheet({ opened, onClose, title, children, position = "right" }: SheetProps) {
  const { t } = useTranslation("ui");
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={title}
      position={position}
      size={position === "right" ? 460 : "auto"}
      closeButtonProps={{ "aria-label": t("sheet.close") }}
      classNames={{
        overlay: classes.overlay,
        content: position === "right" ? classes.content : classes.contentBottom,
        header: classes.header,
        title: classes.title,
        body: classes.body,
      }}
    >
      {children}
    </Drawer>
  );
}
