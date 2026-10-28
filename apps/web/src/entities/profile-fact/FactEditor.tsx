// Форма факта профиля (PROF-05, design/screens/Memory.dc.html: «Исправить», «Указать», «Добавить факт»): поля по ключу
// факта, проверка — той же схемой контракта, что и на сервере (FactValueInput). Возраст ребёнка без даты рождения —
// сегодняшний из оценки сервера (PROF-06), чтобы правка не «омолодила» ребёнка. Сумма читается из ввода целыми
// копейками (parseMoney) — сайт её не считает.
import {
  EmploymentType,
  FACT_TOPICS,
  FactValueInput,
  FamilyStatus,
  HousingQueueStatus,
  type FactKey,
  type ProfileFact,
} from "@kosht/contract";
import { formatMoneyParts, parseMoney } from "@kosht/i18n";
import {
  Button,
  Checkbox,
  Group,
  NumberInput,
  Radio,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import classes from "./FactEditor.module.css";

interface ChildDraft {
  readonly name: string;
  readonly birthDate: string;
  readonly age: number | null;
  readonly disability: boolean;
}

/** Черновик формы: поля всех ключей сразу, в значение входа его превращает toInput. */
interface Draft {
  readonly flag: "yes" | "no" | null;
  readonly types: readonly string[];
  readonly statuses: readonly string[];
  readonly housing: string | null;
  readonly date: string;
  readonly name: string;
  readonly amount: string;
  readonly children: readonly ChildDraft[];
  readonly topic: string;
  readonly label: string;
  readonly text: string;
}

const EMPTY: Draft = {
  flag: null,
  types: [],
  statuses: [],
  housing: null,
  date: "",
  name: "",
  amount: "",
  children: [],
  topic: "other",
  label: "",
  text: "",
};

/** Черновик из сохранённого факта (или пустой для «Указать» и «Добавить»). */
export function draftOf(fact: ProfileFact | undefined): Draft {
  if (fact === undefined) return EMPTY;
  const { value } = fact;
  switch (value.key) {
    case "employment":
      return { ...EMPTY, types: value.types };
    case "mainEmployer":
      return { ...EMPTY, flag: value.has ? "yes" : "no", name: value.name ?? "" };
    case "children":
      return {
        ...EMPTY,
        children: value.children.map((child, index) => ({
          name: child.name ?? "",
          birthDate: child.birthDate ?? "",
          age: child.birthDate === null ? (fact.evaluation?.childAges?.[index] ?? null) : null,
          disability: child.disability,
        })),
      };
    case "familyStatus":
      return { ...EMPTY, statuses: value.statuses };
    case "housingQueue":
      return { ...EMPTY, housing: value.status, date: value.since ?? "" };
    case "youngSpecialist":
      return { ...EMPTY, flag: value.value ? "yes" : "no", date: value.until ?? "" };
    case "income.salary": {
      const parts = formatMoneyParts(value.amount);
      return { ...EMPTY, amount: `${parts.negative ? "-" : ""}${parts.amount}` };
    }
    case "note":
      return { ...EMPTY, topic: value.topic, label: value.label, text: value.text };
    default:
      return { ...EMPTY, flag: value.value ? "yes" : "no" };
  }
}

/** Значение входа из черновика; не прошло схему контракта — undefined (кнопка «Сохранить» неактивна). */
export function toInput(key: FactKey, draft: Draft): FactValueInput | undefined {
  const date = draft.date === "" ? null : draft.date;
  const flag = draft.flag === null ? undefined : draft.flag === "yes";
  const raw: Record<FactKey, unknown> = {
    employment: { key, types: draft.types },
    mainEmployer: { key, has: flag, name: flag === true && draft.name !== "" ? draft.name : null },
    children: {
      key,
      children: draft.children.map((child) => ({
        name: child.name === "" ? null : child.name,
        birthDate: child.birthDate === "" ? null : child.birthDate,
        age: child.birthDate === "" ? child.age : null,
        disability: child.disability,
      })),
    },
    familyStatus: { key, statuses: draft.statuses },
    largeFamily: { key, value: flag },
    housingQueue: { key, status: draft.housing, since: date },
    benefitCategory: { key, value: flag },
    youngSpecialist: { key, value: flag, until: date },
    "property.apartment": { key, value: flag },
    "property.land": { key, value: flag },
    "property.car": { key, value: flag },
    "income.salary": { key, amount: parseMoney(draft.amount, "BYN") },
    note: { key, topic: draft.topic, label: draft.label, text: draft.text },
  };
  const parsed = FactValueInput.safeParse(raw[key]);
  return parsed.success ? parsed.data : undefined;
}

export interface FactEditorProps {
  readonly factKey: FactKey;
  readonly fact?: ProfileFact;
  readonly pending?: boolean;
  readonly onSubmit: (value: FactValueInput) => void;
  readonly onCancel: () => void;
}

export function FactEditor({
  factKey,
  fact,
  pending = false,
  onSubmit,
  onCancel,
}: FactEditorProps) {
  const { t } = useTranslation("profile");
  const [draft, setDraft] = useState<Draft>(() => draftOf(fact));
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const value = toInput(factKey, draft);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value !== undefined) onSubmit(value);
  };
  const property = factKey.startsWith("property.") || factKey === "mainEmployer";
  const yesNo = (
    <Radio.Group
      label={t(`keys.${factKey}`)}
      value={draft.flag}
      onChange={(flag) => patch({ flag: flag === "yes" ? "yes" : "no" })}
    >
      <Group mt="xs">
        <Radio value="yes" label={property ? t("editor.has") : t("editor.yes")} />
        <Radio value="no" label={property ? t("editor.hasNot") : t("editor.no")} />
      </Group>
    </Radio.Group>
  );
  return (
    <form className={classes.form} onSubmit={submit}>
      <Stack gap="md">
        {factKey === "employment" && (
          <Checkbox.Group
            label={t("keys.employment")}
            value={[...draft.types]}
            onChange={(types) => patch({ types })}
          >
            <Stack gap="xs" mt="xs">
              {EmploymentType.options.map((type) => (
                <Checkbox key={type} value={type} label={t(`employment.${type}`)} />
              ))}
            </Stack>
          </Checkbox.Group>
        )}
        {factKey === "familyStatus" && (
          <Checkbox.Group
            label={t("keys.familyStatus")}
            value={[...draft.statuses]}
            onChange={(statuses) => patch({ statuses })}
          >
            <Stack gap="xs" mt="xs">
              {FamilyStatus.options.map((status) => (
                <Checkbox key={status} value={status} label={t(`family.${status}`)} />
              ))}
            </Stack>
          </Checkbox.Group>
        )}
        {factKey === "housingQueue" && (
          <>
            <Radio.Group
              label={t("keys.housingQueue")}
              value={draft.housing}
              onChange={(housing) => patch({ housing })}
            >
              <Stack gap="xs" mt="xs">
                {HousingQueueStatus.options.map((status) => (
                  <Radio key={status} value={status} label={t(`housing.${status}`)} />
                ))}
              </Stack>
            </Radio.Group>
            <TextInput
              type="date"
              label={t("editor.since")}
              value={draft.date}
              onChange={(event) => patch({ date: event.currentTarget.value })}
            />
          </>
        )}
        {(factKey === "largeFamily" ||
          factKey === "benefitCategory" ||
          factKey.startsWith("property.")) &&
          yesNo}
        {factKey === "youngSpecialist" && (
          <>
            {yesNo}
            <TextInput
              type="date"
              label={t("editor.until")}
              value={draft.date}
              onChange={(event) => patch({ date: event.currentTarget.value })}
            />
          </>
        )}
        {factKey === "mainEmployer" && (
          <>
            {yesNo}
            {draft.flag === "yes" && (
              <TextInput
                label={t("editor.employerName")}
                value={draft.name}
                maxLength={120}
                onChange={(event) => patch({ name: event.currentTarget.value })}
              />
            )}
          </>
        )}
        {factKey === "income.salary" && (
          <TextInput
            label={t("editor.amount")}
            inputMode="decimal"
            value={draft.amount}
            error={draft.amount !== "" && value === undefined ? t("editor.amountInvalid") : null}
            onChange={(event) => patch({ amount: event.currentTarget.value })}
          />
        )}
        {factKey === "children" && (
          <ChildrenFields items={draft.children} onChange={(children) => patch({ children })} />
        )}
        {factKey === "note" && (
          <>
            <Select
              label={t("editor.topic")}
              data={FACT_TOPICS.map((topic) => ({ value: topic, label: t(`topics.${topic}`) }))}
              value={draft.topic}
              allowDeselect={false}
              onChange={(topic) => patch({ topic: topic ?? "other" })}
            />
            <TextInput
              label={t("editor.label")}
              placeholder={t("editor.labelPlaceholder")}
              value={draft.label}
              maxLength={80}
              onChange={(event) => patch({ label: event.currentTarget.value })}
            />
            <Textarea
              label={t("editor.text")}
              placeholder={t("editor.textPlaceholder")}
              value={draft.text}
              maxLength={300}
              autosize
              minRows={2}
              onChange={(event) => patch({ text: event.currentTarget.value })}
            />
          </>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={onCancel}>
            {t("editor.cancel")}
          </Button>
          <Button type="submit" disabled={value === undefined} loading={pending}>
            {t("editor.save")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function ChildrenFields({
  items: children,
  onChange,
}: {
  readonly items: readonly ChildDraft[];
  readonly onChange: (children: readonly ChildDraft[]) => void;
}) {
  const { t } = useTranslation("profile");
  const update = (index: number, next: Partial<ChildDraft>) =>
    onChange(children.map((child, i) => (i === index ? { ...child, ...next } : child)));
  return (
    <Stack gap="sm">
      {children.map((child, index) => {
        const n = index + 1;
        return (
          <fieldset key={n} className={classes.child}>
            <legend className={classes.legend}>{t("editor.childTitle", { n })}</legend>
            <div className={classes.childGrid}>
              <TextInput
                label={t("editor.childName")}
                value={child.name}
                maxLength={60}
                onChange={(event) => update(index, { name: event.currentTarget.value })}
              />
              <TextInput
                type="date"
                label={t("editor.childBirthDate")}
                value={child.birthDate}
                onChange={(event) => update(index, { birthDate: event.currentTarget.value })}
              />
              {child.birthDate === "" && (
                <NumberInput
                  label={t("editor.childAge")}
                  min={0}
                  max={40}
                  allowDecimal={false}
                  value={child.age ?? ""}
                  onChange={(age) => update(index, { age: typeof age === "number" ? age : null })}
                />
              )}
            </div>
            <Group justify="space-between" mt="xs">
              <Checkbox
                label={t("editor.childDisability")}
                checked={child.disability}
                onChange={(event) => update(index, { disability: event.currentTarget.checked })}
              />
              <Button
                variant="subtle"
                color="red"
                leftSection={<Trash2 size={16} aria-hidden />}
                onClick={() => onChange(children.filter((_, i) => i !== index))}
              >
                {t("editor.removeChild", { n })}
              </Button>
            </Group>
          </fieldset>
        );
      })}
      <Button
        variant="default"
        leftSection={<Plus size={16} aria-hidden />}
        onClick={() =>
          onChange([...children, { name: "", birthDate: "", age: null, disability: false }])
        }
      >
        {t("editor.addChild")}
      </Button>
    </Stack>
  );
}
