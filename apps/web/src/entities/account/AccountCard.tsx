// Карточка счёта (design/screens/Accounts.dc.html, .ac-card): значок вида, название, вид и валюта, остаток. Название
// без своего имени — подпись по виду из словаря («Наличные»). Остаток приходит с сервера готовым (P1); «Откуда эта
// цифра?», график, последняя операция и меню счёта — T-019 и T-014.
import type { AccountListItem } from "@kosht/contract";
import { VisuallyHidden } from "@mantine/core";
import { Banknote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Money } from "../../ui/index.ts";
import classes from "./AccountCard.module.css";

export interface AccountCardProps {
  readonly account: AccountListItem;
}

export function AccountCard({ account }: AccountCardProps) {
  const { t } = useTranslation("accounts");
  const name = account.name ?? t(`kind.${account.kind}`);
  const titleId = `account-${account.id}`;
  return (
    <article className={classes.card} aria-labelledby={titleId}>
      <div className={classes.head}>
        <span className={classes.icon}>
          <Banknote size={20} strokeWidth={1.8} aria-hidden />
        </span>
        <div className={classes.titles}>
          <h2 id={titleId} className={classes.name}>
            {name}
          </h2>
          <p className={classes.note}>{t("cashNote", { currency: account.balance.currency })}</p>
        </div>
      </div>
      <p className={classes.balance}>
        <VisuallyHidden>{t("balance")}</VisuallyHidden>
        <Money value={account.balance} size="kpi" />
      </p>
    </article>
  );
}
