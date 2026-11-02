// «Пользователи» (ADM-30, AUTH-05, AUTH-12, R37, PRIV-07; Admin.dc.html — Admin--users): учётные записи без данных
// домохозяйств. Действия — меню «…» строки: заблокировать или разблокировать и назначить или снять администратора —
// сразу, итог строкой (последний администратор — текст LAST_ADMIN с сервера); сбросить пароль — письмом пользователю
// или, без подтверждённой почты, окном со ссылкой и предупреждением; удалить — ConfirmDialog с вводом email.
import type { AdminResetResult, AdminUser } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";
import { ActionIcon, Button, Menu, Modal, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  MoreHorizontal,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unlock,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { ConfirmDialog, SkeletonList, StatusBadge } from "../../ui/index.ts";
import classes from "./Admin.module.css";

const dayOf = (iso: string) => formatDate(LocalDate.fromInstant(new Date(iso), DEFAULT_TIME_ZONE));

export function AdminUsersPage() {
  const { t } = useTranslation(["admin", "errors"]);
  const queryClient = useQueryClient();
  const users = useQuery(orpc.admin.users.queryOptions());
  const [done, setDone] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<AdminUser | undefined>();
  const [link, setLink] = useState<string | undefined>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.users.key() });
  const fail = (error: unknown) => {
    setDone(undefined);
    setFailure(t(`errors:${errorCodeOf(error)}`, errorParamsOf(error)));
  };
  const succeed = (text: string) => {
    setFailure(undefined);
    setDone(text);
  };
  const status = useMutation(
    orpc.admin.setUserStatus.mutationOptions({ onSettled: refresh, onError: fail }),
  );
  const role = useMutation(
    orpc.admin.setUserRole.mutationOptions({ onSettled: refresh, onError: fail }),
  );
  const reset = useMutation(orpc.admin.resetUserPassword.mutationOptions({ onError: fail }));

  function onReset(user: AdminUser, result: AdminResetResult) {
    if (result.delivery === "shown") {
      setFailure(undefined);
      setDone(undefined);
      setLink(result.link);
    } else {
      succeed(
        t(result.delivery === "telegram" ? "users.resetTelegram" : "users.resetMailed", {
          email: user.email,
        }),
      );
    }
  }

  return (
    <>
      <section className={classes.card} aria-labelledby="admin-users">
        <div className={classes.cardHead}>
          <h2 id="admin-users" className={classes.cardTitle}>
            {t("users.title", { count: users.data?.items.length ?? 0 })}
          </h2>
          <p className={classes.hint}>{t("users.hidden")}</p>
        </div>
        {users.isPending && <SkeletonList rows={4} />}
        {users.isError && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {t("users.error")}
          </p>
        )}
        {done !== undefined && (
          <output className={classes.ok}>
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
            {done}
          </output>
        )}
        {failure !== undefined && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {failure}
          </p>
        )}
        {users.isSuccess && (
          <table className={`${classes.table} ${classes.stack}`}>
            <thead>
              <tr>
                <th scope="col">{t("users.email")}</th>
                <th scope="col">{t("users.mail")}</th>
                <th scope="col">{t("users.status")}</th>
                <th scope="col">{t("users.role")}</th>
                <th scope="col">{t("users.telegram")}</th>
                <th scope="col">{t("users.mode")}</th>
                <th scope="col">{t("users.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((user) => (
                <tr key={user.id}>
                  <th scope="row">
                    <span className={classes.email}>
                      {user.email}
                      {user.self && <span className={classes.tag}>{t("users.you")}</span>}
                      {user.demo && <span className={classes.tag}>{t("users.demo")}</span>}
                    </span>
                    <span className={classes.hint}>
                      {t("users.since", { date: dayOf(user.registeredAt) })}
                    </span>
                  </th>
                  <td data-label={t("users.mail")}>
                    {user.emailVerified ? (
                      <StatusBadge tone="ok" icon={CheckCircle2}>
                        {t("users.verified")}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral" icon={XCircle}>
                        {t("users.unverified")}
                      </StatusBadge>
                    )}
                  </td>
                  <td data-label={t("users.status")}>
                    {user.status === "active" ? (
                      <StatusBadge tone="ok" icon={CheckCircle2}>
                        {t("users.active")}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="danger" icon={Lock}>
                        {t("users.blocked")}
                      </StatusBadge>
                    )}
                  </td>
                  <td data-label={t("users.role")}>{t(`users.roles.${user.role}`)}</td>
                  <td data-label={t("users.telegram")}>{t("users.noTelegram")}</td>
                  <td data-label={t("users.mode")}>
                    {user.cloud ? t("users.cloud") : t("users.local")}
                  </td>
                  <td aria-label={t("users.actions")}>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          size={44}
                          aria-label={t("users.menu", { email: user.email })}
                        >
                          <MoreHorizontal size={18} strokeWidth={1.8} aria-hidden />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={
                            user.status === "active" ? (
                              <Lock size={16} aria-hidden />
                            ) : (
                              <Unlock size={16} aria-hidden />
                            )
                          }
                          onClick={() =>
                            status.mutate(
                              {
                                id: user.id,
                                status: user.status === "active" ? "blocked" : "active",
                              },
                              {
                                onSuccess: () =>
                                  succeed(
                                    user.status === "active"
                                      ? t("users.blockedDone", { email: user.email })
                                      : t("users.unblockedDone", { email: user.email }),
                                  ),
                              },
                            )
                          }
                        >
                          {user.status === "active" ? t("users.block") : t("users.unblock")}
                        </Menu.Item>
                        <Menu.Item
                          leftSection={
                            user.role === "admin" ? (
                              <ShieldOff size={16} aria-hidden />
                            ) : (
                              <ShieldCheck size={16} aria-hidden />
                            )
                          }
                          onClick={() =>
                            role.mutate(
                              { id: user.id, role: user.role === "admin" ? "user" : "admin" },
                              {
                                onSuccess: () =>
                                  succeed(
                                    user.role === "admin"
                                      ? t("users.userDone", { email: user.email })
                                      : t("users.adminDone", { email: user.email }),
                                  ),
                              },
                            )
                          }
                        >
                          {user.role === "admin" ? t("users.removeAdmin") : t("users.makeAdmin")}
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<KeyRound size={16} aria-hidden />}
                          disabled={user.status !== "active"}
                          onClick={() =>
                            reset.mutate(
                              { id: user.id },
                              { onSuccess: (result) => onReset(user, result) },
                            )
                          }
                        >
                          {t("users.resetPassword")}
                        </Menu.Item>
                        <Menu.Item
                          color="var(--danger)"
                          leftSection={<Trash2 size={16} aria-hidden />}
                          onClick={() => {
                            // DEMO-03: демо не удаляют — его данные пересоздаёт кнопка во вкладке «Система».
                            if (user.demo) {
                              setDone(undefined);
                              setFailure(t("users.demoNoDelete"));
                            } else setDeleting(user);
                          }}
                        >
                          {t("users.delete")}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className={classes.note}>
        <KeyRound size={18} strokeWidth={1.8} aria-hidden />
        {t("users.policy")}
      </p>
      {deleting !== undefined && (
        <DeleteUserDialog
          user={deleting}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            succeed(t("users.deleteDialog.done", { email: deleting.email }));
            setDeleting(undefined);
            void refresh();
          }}
        />
      )}
      <ResetLinkDialog link={link} onClose={() => setLink(undefined)} />
    </>
  );
}

/** Подтверждение удаления: email удаляемого вводится вручную (ADM-30); сверяет и сервер. */
function DeleteUserDialog({
  user,
  onClose,
  onDeleted,
}: {
  readonly user: AdminUser;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const { t } = useTranslation(["admin", "errors"]);
  const [email, setEmail] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const remove = useMutation(orpc.admin.deleteUser.mutationOptions({ onSuccess: onDeleted }));
  return (
    <ConfirmDialog
      opened
      title={t("users.deleteDialog.title")}
      confirmLabel={t("users.deleteDialog.confirm")}
      tone="danger"
      pending={remove.isPending}
      onCancel={onClose}
      onConfirm={() => {
        const same = email.trim().toLowerCase() === user.email;
        setMismatch(!same);
        if (same) remove.mutate({ id: user.id, email });
      }}
    >
      <p className={classes.hint}>{t("users.deleteDialog.lead", { email: user.email })}</p>
      <TextInput
        label={t("users.deleteDialog.confirmLabel")}
        value={email}
        autoComplete="off"
        onChange={(event) => setEmail(event.currentTarget.value)}
        error={mismatch ? t("users.deleteDialog.mismatch") : undefined}
      />
      {remove.isError && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(remove.error)}`, errorParamsOf(remove.error))}
        </p>
      )}
    </ConfirmDialog>
  );
}

/** R37: ссылка показана администратору только потому, что доставить её некуда, — с предупреждением. */
function ResetLinkDialog({
  link,
  onClose,
}: {
  readonly link: string | undefined;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation("admin");
  const [copied, setCopied] = useState(false);
  const close = () => {
    setCopied(false);
    onClose();
  };
  return (
    <Modal
      opened={link !== undefined}
      onClose={close}
      title={t("users.linkDialog.title")}
      centered
      size={520}
      radius="lg"
      closeButtonProps={{ "aria-label": t("users.linkDialog.close") }}
    >
      <div className={classes.card}>
        <p className={classes.warn}>
          <AlertTriangle size={18} strokeWidth={1.8} aria-hidden />
          {t("users.linkDialog.warning")}
        </p>
        <p className={`${classes.link} ${classes.mono}`}>{link}</p>
        <div className={classes.dialogActions}>
          <Button
            variant="default"
            leftSection={<Copy size={16} strokeWidth={1.8} aria-hidden />}
            onClick={() => {
              void navigator.clipboard.writeText(link ?? "").then(() => setCopied(true));
            }}
          >
            {copied ? t("users.linkDialog.copied") : t("users.linkDialog.copy")}
          </Button>
          <Button onClick={close}>{t("users.linkDialog.close")}</Button>
        </div>
      </div>
    </Modal>
  );
}
