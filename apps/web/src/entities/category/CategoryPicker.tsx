// Выбор категории (CAT-01, CAT-02, design/screens/Operations.dc.html — поле «Категория» карточки и ручного ввода):
// встроенные нужного типа и свои, без скрытых (кроме уже выбранной), значок и цвет у каждой; «Новая категория» —
// окно с названием, цветом и значком (categories.create), новая сразу выбирается. В «Операции» его встраивает T-021.
import {
  CATEGORY_COLOR_KEYS,
  CATEGORY_ICON_KEYS,
  NewCategoryInput,
  type CategoryItem,
  type CategoryKind,
  type CategoryRef,
} from "@kosht/contract";
import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf } from "../../lib/errors.ts";
import { CategoryIcon } from "../../ui/index.ts";
import classes from "./CategoryPicker.module.css";
import { categoryName, refKey } from "./category-key.ts";

export interface CategoryPickerProps {
  readonly kind: CategoryKind;
  readonly value: CategoryRef | null;
  readonly onChange: (ref: CategoryRef) => void;
  readonly label?: string;
}

export function CategoryPicker({ kind, value, onChange, label }: CategoryPickerProps) {
  const { t } = useTranslation("categories");
  const { t: tUi } = useTranslation("ui");
  const list = useQuery(orpc.categories.list.queryOptions());
  const [creating, setCreating] = useState(false);
  const selected = value === null ? null : refKey(value);
  const items = (list.data?.items ?? []).filter(
    (item) => item.kind === kind && (!item.hidden || refKey(item.ref) === selected),
  );
  const byKey = new Map(items.map((item) => [refKey(item.ref), item]));
  return (
    <div className={classes.picker}>
      <Select
        label={label ?? t("picker.label")}
        placeholder={t("picker.placeholder")}
        searchable
        nothingFoundMessage={t("picker.nothing")}
        data={items.map((item) => ({ value: refKey(item.ref), label: categoryName(t, item) }))}
        value={selected}
        allowDeselect={false}
        error={list.isError ? t("picker.loadError") : null}
        leftSection={
          selected !== null && byKey.has(selected) ? (
            <CategoryIcon
              size="sm"
              icon={byKey.get(selected)?.icon ?? "circle-ellipsis"}
              color={byKey.get(selected)?.color ?? "other"}
            />
          ) : undefined
        }
        renderOption={({ option }) => {
          const item = byKey.get(option.value);
          return (
            <span className={classes.option}>
              {item !== undefined && <CategoryIcon size="sm" icon={item.icon} color={item.color} />}
              {option.label}
            </span>
          );
        }}
        onChange={(key) => {
          const item = key === null ? undefined : byKey.get(key);
          if (item !== undefined) onChange(item.ref);
        }}
      />
      <Button
        variant="subtle"
        size="sm"
        leftSection={<Plus size={16} aria-hidden />}
        onClick={() => setCreating(true)}
      >
        {t("picker.create")}
      </Button>
      <Modal
        opened={creating}
        onClose={() => setCreating(false)}
        title={t("picker.createTitle")}
        closeButtonProps={{ "aria-label": tUi("sheet.close") }}
      >
        {creating && (
          <NewCategoryForm
            kind={kind}
            onCancel={() => setCreating(false)}
            onCreated={(item) => {
              setCreating(false);
              onChange(item.ref);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function NewCategoryForm({
  kind,
  onCreated,
  onCancel,
}: {
  readonly kind: CategoryKind;
  readonly onCreated: (item: CategoryItem) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation(["categories", "errors"]);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("other");
  const [icon, setIcon] = useState<string>("circle-ellipsis");
  const create = useMutation(
    orpc.categories.create.mutationOptions({
      onSuccess: async ({ item }) => {
        await queryClient.invalidateQueries({ queryKey: orpc.categories.key() });
        onCreated(item);
      },
    }),
  );
  const input = NewCategoryInput.safeParse({ name, kind, color, icon });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (input.success) create.mutate(input.data);
  };
  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <TextInput
          label={t("categories:picker.name")}
          placeholder={t("categories:picker.namePlaceholder")}
          value={name}
          maxLength={40}
          data-autofocus
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Group grow>
          <Select
            label={t("categories:picker.color")}
            data={CATEGORY_COLOR_KEYS.map((key) => ({
              value: key,
              label: t(`categories:picker.colors.${key}`),
            }))}
            value={color}
            allowDeselect={false}
            renderOption={({ option }) => (
              <span className={classes.option}>
                <CategoryIcon size="sm" icon={icon as never} color={option.value as never} />
                {option.label}
              </span>
            )}
            onChange={(value) => setColor(value ?? "other")}
          />
          <Select
            label={t("categories:picker.icon")}
            data={CATEGORY_ICON_KEYS.map((key) => ({
              value: key,
              label: t(`categories:picker.icons.${key}`),
            }))}
            value={icon}
            allowDeselect={false}
            searchable
            renderOption={({ option }) => (
              <span className={classes.option}>
                <CategoryIcon size="sm" icon={option.value as never} color={color as never} />
                {option.label}
              </span>
            )}
            onChange={(value) => setIcon(value ?? "circle-ellipsis")}
          />
        </Group>
        {create.isError && (
          <p className={classes.error} role="alert">
            {t("categories:picker.error", { reason: t(`errors:${errorCodeOf(create.error)}`) })}
          </p>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={onCancel}>
            {t("categories:picker.cancel")}
          </Button>
          <Button type="submit" disabled={!input.success} loading={create.isPending}>
            {t("categories:picker.save")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
