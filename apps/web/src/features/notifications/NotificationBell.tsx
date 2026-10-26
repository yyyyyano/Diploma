// Колокольчик каркаса (NOTIF-01, NOTIF-03; design/screens/Main.dc.html — Main--notifications): счётчик непрочитанных и
// список — лента пользователя с курсором («Показать ещё») и, у администратора, его уведомления отдельным блоком.
// Новое уведомление обновляет колокольчик без перезагрузки: сигнал notification из events.stream перезапрашивает
// активные запросы (lib/events). «Прочитать все», «Настроить уведомления» → /settings?tab=notifications.
import type { AdminNotification } from "@kosht/contract";
import { Button, Popover } from "@mantine/core";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NotificationItem } from "../../entities/notification/index.ts";
import { orpc } from "../../lib/api.ts";
import classes from "./NotificationBell.module.css";

export interface NotificationBellProps {
  /** Администратор видит и уведомления администраторов (NOTIF-03). */
  readonly admin: boolean;
}

const PAGE = 20;

export function NotificationBell({ admin }: NotificationBellProps) {
  const { t } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const feed = useInfiniteQuery(
    orpc.notifications.list.infiniteOptions({
      input: (cursor: string | undefined) =>
        cursor === undefined ? { limit: PAGE } : { cursor, limit: PAGE },
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  const adminFeed = useQuery({
    ...orpc.notifications.adminList.queryOptions({ input: { limit: PAGE } }),
    enabled: admin,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.notifications.key() });
  const markRead = useMutation(orpc.notifications.markRead.mutationOptions({ onSuccess: refresh }));
  const markAll = useMutation(
    orpc.notifications.markAllRead.mutationOptions({ onSuccess: refresh }),
  );
  const markAdmin = useMutation(
    orpc.notifications.adminMarkRead.mutationOptions({ onSuccess: refresh }),
  );

  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const adminItems: AdminNotification[] = admin ? (adminFeed.data?.items ?? []) : [];
  const unread = (feed.data?.pages[0]?.unread ?? 0) + (admin ? (adminFeed.data?.unread ?? 0) : 0);

  return (
    <Popover
      position="bottom-end"
      width="min(380px, calc(100vw - 32px))"
      shadow="md"
      radius="lg"
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          className={classes.bell}
          aria-label={unread === 0 ? t("bell") : t("bellUnread", { count: unread })}
        >
          <Bell size={20} strokeWidth={1.8} aria-hidden />
          {unread > 0 && (
            <span className={classes.badge} aria-hidden>
              {unread > 99 ? t("badgeMany") : unread}
            </span>
          )}
        </button>
      </Popover.Target>
      <Popover.Dropdown className={classes.dropdown}>
        <section aria-labelledby="notifications-title">
          <header className={classes.head}>
            <h2 id="notifications-title" className={classes.title}>
              {t("title")}
            </h2>
            {unread > 0 && (
              <Button
                variant="subtle"
                size="xs"
                loading={markAll.isPending}
                onClick={() => markAll.mutate({})}
              >
                {t("readAll")}
              </Button>
            )}
          </header>
          <div className={classes.list}>
            {adminItems.length > 0 && (
              <div className={classes.admin}>
                <h3 className={classes.adminTitle}>
                  <ShieldAlert size={16} strokeWidth={1.8} aria-hidden />
                  {t("admin")}
                </h3>
                <ul>
                  {adminItems.map((item) => (
                    <li key={item.id} data-unread={!item.read}>
                      <button
                        type="button"
                        className={classes.adminItem}
                        onClick={() => {
                          if (!item.read) markAdmin.mutate({ ids: [item.id] });
                        }}
                      >
                        {t(`adminKinds.${item.kind}`, item.params)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {feed.isError && (
              <p role="alert" className={classes.note}>
                {t("error")}
              </p>
            )}
            {feed.isSuccess && items.length === 0 && adminItems.length === 0 && (
              <p className={classes.note}>{t("empty")}</p>
            )}
            {items.length > 0 && (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <NotificationItem
                      notification={item}
                      onRead={(id) => markRead.mutate({ ids: [id] })}
                    />
                  </li>
                ))}
              </ul>
            )}
            {feed.hasNextPage && (
              <Button
                variant="subtle"
                fullWidth
                loading={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {t("more")}
              </Button>
            )}
          </div>
          <footer className={classes.foot}>
            <Link to="/settings" search={{ tab: "notifications" }}>
              {t("settings")}
            </Link>
          </footer>
        </section>
      </Popover.Dropdown>
    </Popover>
  );
}
