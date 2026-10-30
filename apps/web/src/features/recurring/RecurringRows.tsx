// Строка платежа: состояние, меню действий (REC-02).
import type { RecurringItem } from "@kosht/contract";
import { Menu } from "@mantine/core";
import { AlertTriangle, Check, Clock, EllipsisVertical } from "lucide-react";
import { StatusBadge } from "../../ui/index.ts";
import classes from "./RecurringPage.module.css";
import type { T } from "./model/format.ts";

export function StateBadge({ t, item }: { readonly t: T; readonly item: RecurringItem }) {
  if (item.state === "maybe-ended") {
    return (
      <StatusBadge tone="warn" icon={AlertTriangle}>
        {t("badge.maybeEnded")}
      </StatusBadge>
    );
  }
  if (item.state === "suggested") {
    return (
      <StatusBadge tone="neutral" icon={Clock}>
        {t("badge.suggested")}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone={item.section === "subscriptions" ? "brand" : "ok"} icon={Check}>
      {item.section === "subscriptions" ? t("badge.subscription") : t("badge.active")}
    </StatusBadge>
  );
}

export function RowMenu({
  t,
  item,
  onEdit,
  onOperations,
  onExclude,
  onEnd,
}: {
  readonly t: T;
  readonly item: RecurringItem;
  readonly onEdit: () => void;
  readonly onOperations: () => void;
  readonly onExclude: () => void;
  readonly onEnd: () => void;
}) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <button
          type="button"
          className={classes.menuButton}
          aria-label={t("row.menu", { name: item.name })}
        >
          <EllipsisVertical size={20} aria-hidden />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={onEdit}>{t("menu.edit")}</Menu.Item>
        {item.source === "detected" && (
          <Menu.Item onClick={onOperations}>{t("menu.operations")}</Menu.Item>
        )}
        <Menu.Item onClick={onEnd}>{t("menu.end")}</Menu.Item>
        <Menu.Item color="red" onClick={onExclude}>
          {t("menu.exclude")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
