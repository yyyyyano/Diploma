// Карточка счёта (design/screens/Accounts.dc.html, .ac-card): значок вида, название (своё или по виду, у карты — банк и
// маска), вид и валюта, остаток в валюте счёта и день, на который он известен (STMT-02, показывается всегда), у валюты —
// эквивалент в BYN по курсу НБРБ (STMT-09). Числа приходят с сервера готовыми (P1); ⓘ «Откуда эта цифра?» и меню
// действий подставляет страница (whyBalance, whyInByn, menu) — в карточке чата их нет.
import type { AccountListItem } from "@kosht/contract";
import { formatDate, formatMoney, formatScaled } from "@kosht/i18n";
import { VisuallyHidden } from "@mantine/core";
import {
  Banknote,
  CreditCard,
  FileText,
  Landmark,
  PiggyBank,
  ScanLine,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../../ui/cx.ts";
import { Money } from "../../ui/index.ts";
import classes from "./AccountCard.module.css";

const ICONS: Record<AccountListItem["kind"], LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  current: Wallet,
  savings: PiggyBank,
  deposit: Landmark,
  "unknown-card": ScanLine,
};

/** Название счёта для человека: своё; иначе банк и маска; иначе вид. */
export function useAccountName(): (
  account: Pick<AccountListItem, "name" | "bank" | "mask" | "kind">,
) => string {
  const { t } = useTranslation("accounts");
  return (account) => {
    if (account.name !== null) return account.name;
    if (account.bank !== null && account.mask !== null) {
      return t("maskName", { bank: account.bank, mask: account.mask });
    }
    return account.bank ?? t(`kind.${account.kind}`);
  };
}

export interface AccountCardProps {
  readonly account: AccountListItem;
  /** ⓘ у остатка («Откуда эта цифра?»). */
  readonly whyBalance?: ReactNode;
  /** ⓘ у эквивалента в BYN. */
  readonly whyInByn?: ReactNode;
  /** Меню действий со счётом. */
  readonly menu?: ReactNode;
}

export function AccountCard({ account, whyBalance, whyInByn, menu }: AccountCardProps) {
  const { t } = useTranslation("accounts");
  const name = useAccountName()(account);
  const titleId = `account-${account.id}`;
  const Icon = ICONS[account.kind];
  const kind = t(`kind.${account.kind}`);
  const serviceCash =
    account.kind === "cash" && account.balance.currency === "BYN" && account.name === null;
  const sub =
    account.kind === "unknown-card"
      ? t("unknownNote")
      : serviceCash
        ? t("cashNote", { currency: account.balance.currency })
        : account.bank !== null && account.name !== null
          ? t("subBank", { bank: account.bank, kind, currency: account.balance.currency })
          : t("sub", { kind, currency: account.balance.currency });
  return (
    <article
      className={cx(classes.card, account.kind === "unknown-card" && classes.service)}
      aria-labelledby={titleId}
    >
      <div className={classes.head}>
        <span className={cx(classes.icon, classes[account.kind])}>
          <Icon size={20} strokeWidth={1.8} aria-hidden />
        </span>
        <div className={classes.titles}>
          <h2 id={titleId} className={classes.name}>
            {name}
          </h2>
          <p className={classes.note}>{sub}</p>
        </div>
        {menu}
      </div>
      {account.kind === "unknown-card" && <p className={classes.text}>{t("unknownText")}</p>}
      <p className={classes.balance}>
        <VisuallyHidden>{t("balance")}</VisuallyHidden>
        <Money value={account.balance} size="kpi" />
        {whyBalance}
      </p>
      {account.balance.currency !== "BYN" && (
        <p className={classes.inByn}>
          {account.balanceInByn === null || account.rate === null ? (
            t("noRate")
          ) : (
            <>
              {t("inByn", {
                amount: formatMoney(account.balanceInByn),
                rate: formatScaled(account.rate.rateE4, 4),
                date: formatDate(account.rate.date),
              })}
              {whyInByn}
            </>
          )}
        </p>
      )}
      <p className={classes.asOf}>
        <FileText size={16} strokeWidth={1.8} aria-hidden />
        {t(`balanceSource.${account.balanceSource}`, { date: formatDate(account.balanceOn) })}
      </p>
    </article>
  );
}
