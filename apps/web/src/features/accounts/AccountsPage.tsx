// «Счета» (design/screens/Accounts.dc.html, STMT-01): заголовок со счётчиком и карточки счетов. Четыре состояния
// (DES-16): загрузка — скелетоны карточек, ошибка — что случилось и «Попробовать ещё раз», пусто — когда появятся
// «Наличные», успех — карточки. Список обновляется сам: «Наличные» создаёт worker, сигнал account из events.stream
// перезапрашивает запрос (lib/events). Итоги, валюта, добавление и меню счёта — T-019.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Wallet } from "lucide-react";
import { Button } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { AccountCard } from "../../entities/account/index.ts";
import { orpc } from "../../lib/api.ts";
import { EmptyState, PageHeader, SkeletonCard } from "../../ui/index.ts";
import classes from "./AccountsPage.module.css";

export function AccountsPage() {
  const { t } = useTranslation("accounts");
  const accounts = useQuery(orpc.accounts.list.queryOptions());
  const items = accounts.data?.items;
  return (
    <>
      <PageHeader
        title={t("title")}
        {...(items === undefined ? {} : { subtitle: t("count", { count: items.length }) })}
      />
      <div className={classes.body}>
        {accounts.isPending && (
          <div className={classes.grid}>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        {accounts.isError && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("error.title")}
            description={t("error.text")}
            actions={<Button onClick={() => void accounts.refetch()}>{t("error.retry")}</Button>}
          />
        )}
        {items?.length === 0 && (
          <EmptyState icon={Wallet} title={t("empty.title")} description={t("empty.text")} />
        )}
        {items !== undefined && items.length > 0 && (
          <section className={classes.grid} aria-label={t("listLabel")}>
            {items.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </section>
        )}
      </div>
    </>
  );
}
