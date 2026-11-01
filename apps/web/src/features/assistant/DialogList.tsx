// Список диалогов (CHAT-01, design: .as-list): «Новый диалог», группы «Сегодня / Вчера / Ранее», у строки — меню
// «Переименовать» и «Удалить» (удаление — после подтверждения с кнопкой-глаголом: переписку не вернуть). Название
// диалога сервер ставит сам по первому сообщению (без модели); здесь его можно поменять.
import type { ConversationId, ConversationItem } from "@kosht/contract";
import { formatDate, formatTime } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate, timeOfDay } from "@kosht/kernel";
import { ActionIcon, Button, Menu, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Lock, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { ConfirmDialog, SkeletonList } from "../../ui/index.ts";
import classes from "./DialogList.module.css";
import { groupDialogs, groupKeyOf } from "./model/dialog-groups.ts";

export interface DialogListProps {
  /** Открытый диалог; null — новый, ещё без сообщений. */
  readonly activeId: ConversationId | null;
  readonly onOpen: (id: ConversationId) => void;
  readonly onNew: () => void;
  /** Строка под списком: имена и номера заменяются метками перед облаком (только с облачным согласием). */
  readonly cloudNote: boolean;
}

/** «10:42» — сегодня и вчера; «21.10.2026» — раньше. */
function whenOf(item: ConversationItem): string {
  const today = LocalDate.fromInstant(new Date(), DEFAULT_TIME_ZONE);
  const moment = new Date(item.updatedAt);
  return groupKeyOf(item.updatedAt, today) === "earlier"
    ? formatDate(LocalDate.fromInstant(moment, DEFAULT_TIME_ZONE))
    : formatTime(timeOfDay(moment, DEFAULT_TIME_ZONE));
}

export function DialogList({ activeId, onOpen, onNew, cloudNote }: DialogListProps) {
  const { t } = useTranslation("assistant");
  const queryClient = useQueryClient();
  const list = useQuery(orpc.chat.conversations.queryOptions());
  const [renaming, setRenaming] = useState<ConversationId | undefined>();
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<ConversationItem | undefined>();
  const renameRef = useRef<HTMLInputElement>(null);
  // Поле названия получает фокус при открытии (без autoFocus: он ломает порядок чтения диктором).
  useEffect(() => {
    if (renaming !== undefined) renameRef.current?.focus();
  }, [renaming]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.chat.key() });
  const rename = useMutation({
    ...orpc.chat.rename.mutationOptions(),
    onSuccess: () => {
      setRenaming(undefined);
      void refresh();
    },
  });
  const remove = useMutation({
    ...orpc.chat.remove.mutationOptions(),
    onSuccess: (_result, variables) => {
      setRemoving(undefined);
      if (variables.conversationId === activeId) onNew();
      void refresh();
    },
  });

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (renaming === undefined || draft.trim() === "") return;
    rename.mutate({ conversationId: renaming, title: draft.trim() });
  };

  const groups = groupDialogs(list.data?.items ?? []);
  return (
    <nav className={classes.list} aria-label={t("dialogs.label")}>
      <Button
        fullWidth
        size="md"
        leftSection={<Plus size={18} strokeWidth={1.8} aria-hidden />}
        onClick={onNew}
      >
        {t("dialogs.newDialog")}
      </Button>
      {activeId === null && (
        <ul className={classes.rows}>
          <li className={`${classes.row} ${classes.on}`}>
            <span className={classes.open} aria-current="true">
              <span className={classes.title}>{t("dialogs.untitled")}</span>
            </span>
          </li>
        </ul>
      )}
      {list.isPending && <SkeletonList rows={4} />}
      {list.isError && (
        <p className={classes.error} role="alert">
          <TriangleAlert size={16} strokeWidth={1.8} aria-hidden />
          {t("dialogs.error")}
        </p>
      )}
      {list.isSuccess && list.data.items.length === 0 && activeId !== null && (
        <p className={classes.empty}>{t("dialogs.empty")}</p>
      )}
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`dialogs-${group.key}`}>
          <h2 id={`dialogs-${group.key}`} className={classes.group}>
            {t(`dialogs.groups.${group.key}`)}
          </h2>
          <ul className={classes.rows}>
            {group.items.map((item) => {
              const title = item.title ?? t("dialogs.untitled");
              const active = item.id === activeId;
              return (
                <li key={item.id} className={`${classes.row} ${active ? classes.on : ""}`}>
                  {renaming === item.id ? (
                    <form className={classes.rename} onSubmit={submitRename}>
                      <TextInput
                        ref={renameRef}
                        size="sm"
                        aria-label={t("dialogs.renameLabel")}
                        value={draft}
                        maxLength={100}
                        onChange={(event) => setDraft(event.currentTarget.value)}
                        onKeyDown={(event) => event.key === "Escape" && setRenaming(undefined)}
                      />
                      <Button type="submit" size="sm" loading={rename.isPending}>
                        {t("dialogs.renameSave")}
                      </Button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={classes.open}
                        aria-current={active ? "true" : undefined}
                        aria-label={t("dialogs.rowLabel", { title })}
                        onClick={() => onOpen(item.id)}
                      >
                        <span className={classes.title}>{title}</span>
                        <span className={classes.sub}>
                          {whenOf(item)}
                          {item.preview === "" ? "" : ` · ${item.preview}`}
                        </span>
                      </button>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size={44}
                            aria-label={t("dialogs.menu", { title })}
                          >
                            <Ellipsis size={18} strokeWidth={1.8} aria-hidden />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<Pencil size={16} strokeWidth={1.8} aria-hidden />}
                            onClick={() => {
                              setDraft(title);
                              setRenaming(item.id);
                            }}
                          >
                            {t("dialogs.rename")}
                          </Menu.Item>
                          <Menu.Item
                            color="var(--danger)"
                            leftSection={<Trash2 size={16} strokeWidth={1.8} aria-hidden />}
                            onClick={() => setRemoving(item)}
                          >
                            {t("dialogs.remove")}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {(rename.isError || remove.isError) && (
        <p className={classes.error} role="alert">
          <TriangleAlert size={16} strokeWidth={1.8} aria-hidden />
          {t("dialogs.actionError")}
        </p>
      )}
      {cloudNote && (
        <p className={classes.cloudNote}>
          <Lock size={14} strokeWidth={1.8} aria-hidden />
          {t("cloudNote")}
        </p>
      )}
      <ConfirmDialog
        opened={removing !== undefined}
        title={t("dialogs.removeTitle")}
        confirmLabel={t("dialogs.removeConfirm")}
        tone="danger"
        pending={remove.isPending}
        onCancel={() => setRemoving(undefined)}
        onConfirm={() => removing !== undefined && remove.mutate({ conversationId: removing.id })}
      >
        {removing !== undefined &&
          t("dialogs.removeText", { title: removing.title ?? t("dialogs.untitled") })}
      </ConfirmDialog>
    </nav>
  );
}
