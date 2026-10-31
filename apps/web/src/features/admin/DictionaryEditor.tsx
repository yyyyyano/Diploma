// Общий редактор справочников «Законов» (LAW-40): один компонент на семь видов — стартовый каталог, рубрика ЕПК → тема, шаблоны
// заголовков, органы, краткие имена, «бытовое → юридическое», ведомственные страницы. Поля, их вид и варианты приходят с
// сервера вместе со строками (`orpc.admin.lawsDictionary`), подписи — из словаря `admin:laws.dict`.
import { LAW_DICTIONARY_KINDS, type LawDictionary, type LawDictionaryKind } from "@kosht/contract";
import { Button, Modal, Select, Textarea, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { ConfirmDialog, SkeletonCard } from "../../ui/index.ts";
import classes from "./Admin.module.css";

type Row = LawDictionary["rows"][number];
type Field = LawDictionary["fields"][number];

const FIELD_KEYS = [
  "pravoId",
  "title",
  "label",
  "kind",
  "hasText",
  "group",
  "rubric",
  "topic",
  "pattern",
  "alias",
  "word",
  "terms",
  "url",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
const isFieldKey = (name: string): name is FieldKey =>
  (FIELD_KEYS as readonly string[]).includes(name);

type Translate = ReturnType<typeof useTranslation<["admin", "laws", "errors"]>>["t"];

/** Подпись поля; имя, которого нет в словаре (сервер добавил поле раньше сайта), показывается как есть. */
function fieldLabel(t: Translate, name: string): string {
  return isFieldKey(name) ? t(`admin:laws.dict.fields.${name}`) : name;
}

/** Что редактируется: новая строка или существующая (по её ключу). */
type Editing = { readonly id: string | null; readonly values: Readonly<Record<string, string>> };

export function DictionaryEditor() {
  const { t } = useTranslation(["admin", "laws", "errors"]);
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LawDictionaryKind>("start-catalog");
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [removing, setRemoving] = useState<Row | undefined>(undefined);
  const dictionary = useQuery(orpc.admin.lawsDictionary.queryOptions({ input: { kind } }));
  const store = (next: LawDictionary) => {
    queryClient.setQueryData(
      orpc.admin.lawsDictionary.queryKey({ input: { kind: next.kind } }),
      next,
    );
    void queryClient.invalidateQueries({ queryKey: orpc.admin.lawsActs.key() });
  };
  const remove = useMutation(
    orpc.admin.lawsDictionaryRemove.mutationOptions({
      onSuccess: (next) => {
        store(next);
        setRemoving(undefined);
      },
    }),
  );
  return (
    <>
      <div className={classes.cardHead}>
        <Select
          label={t("laws.dict.kind")}
          data={LAW_DICTIONARY_KINDS.map((id) => ({
            value: id,
            label: t(`laws.dict.kinds.${id}.name`),
          }))}
          value={kind}
          allowDeselect={false}
          onChange={(value) => {
            if (value !== null) setKind(value as LawDictionaryKind);
          }}
        />
        <Button
          leftSection={<Plus size={16} strokeWidth={1.8} aria-hidden />}
          disabled={!dictionary.isSuccess}
          onClick={() => setEditing({ id: null, values: {} })}
        >
          {t("laws.dict.add")}
        </Button>
      </div>
      <p className={classes.hint}>{t(`laws.dict.kinds.${kind}.hint`)}</p>
      {dictionary.isPending && <SkeletonCard />}
      {dictionary.isError && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(dictionary.error)}`, errorParamsOf(dictionary.error))}
        </p>
      )}
      {dictionary.isSuccess &&
        (dictionary.data.rows.length === 0 ? (
          <p className={classes.hint}>{t("laws.dict.empty")}</p>
        ) : (
          <table className={`${classes.table} ${classes.stack}`}>
            <thead>
              <tr>
                {dictionary.data.fields.map((field) => (
                  <th key={field.name} scope="col">
                    {fieldLabel(t, field.name)}
                  </th>
                ))}
                <th scope="col">
                  <span className={classes.srOnly}>{t("laws.dict.edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {dictionary.data.rows.map((row) => (
                <tr key={row.id}>
                  {dictionary.data.fields.map((field, index) => {
                    const cell = <ValueText field={field} value={row.values[field.name] ?? ""} />;
                    return index === 0 ? (
                      <th
                        key={field.name}
                        scope="row"
                        className={`${classes.mono} ${classes.cell}`}
                      >
                        {cell}
                      </th>
                    ) : (
                      <td
                        key={field.name}
                        data-label={fieldLabel(t, field.name)}
                        className={classes.cell}
                      >
                        {cell}
                      </td>
                    );
                  })}
                  <td>
                    <div className={classes.rowActions}>
                      <Button
                        variant="default"
                        leftSection={<Pencil size={16} strokeWidth={1.8} aria-hidden />}
                        aria-label={t("laws.dict.editLabel", { row: rowName(row) })}
                        onClick={() => setEditing({ id: row.id, values: row.values })}
                      >
                        {t("laws.dict.edit")}
                      </Button>
                      <Button
                        variant="default"
                        leftSection={<Trash2 size={16} strokeWidth={1.8} aria-hidden />}
                        aria-label={t("laws.dict.removeLabel", { row: rowName(row) })}
                        onClick={() => setRemoving(row)}
                      >
                        {t("laws.dict.remove")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {dictionary.isSuccess && editing !== undefined && (
        <RowForm
          key={editing.id ?? "new"}
          kind={kind}
          fields={dictionary.data.fields}
          editing={editing}
          onSaved={(next) => {
            store(next);
            setEditing(undefined);
          }}
          onClose={() => setEditing(undefined)}
        />
      )}
      <ConfirmDialog
        opened={removing !== undefined}
        title={t("laws.dict.removeTitle")}
        confirmLabel={t("laws.dict.removeConfirm")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => removing !== undefined && remove.mutate({ kind, id: removing.id })}
        onCancel={() => setRemoving(undefined)}
      >
        {removing !== undefined && <p>{t("laws.dict.removeText", { row: rowName(removing) })}</p>}
      </ConfirmDialog>
      {remove.isError && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(remove.error)}`, errorParamsOf(remove.error))}
        </p>
      )}
    </>
  );
}

/** Имя строки для подписи кнопок: её ключ без служебного разделителя. */
function rowName(row: Row): string {
  return row.id.replaceAll("|", " · ");
}

/** Значение поля словами: выбор из списка — подписью, пустое необязательное — «не задана». */
function ValueText({ field, value }: { readonly field: Field; readonly value: string }) {
  const { t } = useTranslation(["admin", "laws", "errors"]);
  if (value === "") return <>{t("admin:laws.dict.none")}</>;
  return <>{optionLabel(t, field, value)}</>;
}

function optionLabel(t: Translate, field: Field, value: string): string {
  if (field.type !== "select") return value;
  if (field.name === "topic" || field.name === "group") {
    return t(`laws:groups.${value}`, { defaultValue: value });
  }
  return t(`admin:laws.dict.options.${field.name}.${value}`, { defaultValue: value });
}

function RowForm({
  kind,
  fields,
  editing,
  onSaved,
  onClose,
}: {
  readonly kind: LawDictionaryKind;
  readonly fields: readonly Field[];
  readonly editing: Editing;
  readonly onSaved: (next: LawDictionary) => void;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(["admin", "laws", "errors"]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, editing.values[f.name] ?? ""])),
  );
  const save = useMutation(orpc.admin.lawsDictionaryUpsert.mutationOptions({ onSuccess: onSaved }));
  const params = save.isError ? (errorParamsOf(save.error) as Record<string, unknown>) : {};
  const field = typeof params["field"] === "string" ? params["field"] : undefined;
  const reason = typeof params["reason"] === "string" ? params["reason"] : undefined;
  const problem =
    save.isError && errorCodeOf(save.error) === "VALIDATION" && field !== undefined
      ? t(`admin:laws.dict.invalid.${reason ?? "format"}`, {
          field: fieldLabel(t, field),
          defaultValue: t("errors:VALIDATION"),
        })
      : save.isError
        ? t(`errors:${errorCodeOf(save.error)}`, errorParamsOf(save.error))
        : null;
  return (
    <Modal
      opened
      onClose={onClose}
      centered
      title={
        editing.id === null ? t("admin:laws.dict.formTitleNew") : t("admin:laws.dict.formTitleEdit")
      }
    >
      <form
        noValidate
        className={classes.fields}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ kind, id: editing.id, values });
        }}
      >
        {fields.map((f) => {
          const label = fieldLabel(t, f.name);
          const set = (value: string) => setValues({ ...values, [f.name]: value });
          if (f.type === "select") {
            return (
              <Select
                key={f.name}
                label={label}
                required={f.required}
                clearable={!f.required}
                data={(f.options ?? []).map((option) => ({
                  value: option,
                  label: optionLabel(t, f, option),
                }))}
                value={values[f.name] === "" ? null : (values[f.name] ?? null)}
                onChange={(value) => set(value ?? "")}
              />
            );
          }
          return f.type === "area" ? (
            <Textarea
              key={f.name}
              label={label}
              required={f.required}
              autosize
              minRows={2}
              value={values[f.name] ?? ""}
              onChange={(event) => set(event.currentTarget.value)}
            />
          ) : (
            <TextInput
              key={f.name}
              label={label}
              required={f.required}
              autoComplete="off"
              value={values[f.name] ?? ""}
              onChange={(event) => set(event.currentTarget.value)}
            />
          );
        })}
        {problem !== null && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {problem}
          </p>
        )}
        {save.isSuccess && (
          <output className={classes.ok}>
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
            {t("admin:laws.dict.saved")}
          </output>
        )}
        <div className={classes.dialogActions}>
          <Button variant="default" onClick={onClose}>
            {t("admin:laws.dict.cancel")}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t("admin:laws.dict.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
