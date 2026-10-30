// Факт профиля для человека (PROF-05, design/screens/Memory.dc.html): подпись по ключу, значение словами и источник.
// Возраст детей — из оценки сервера на сегодня (PROF-06): сайт его не считает.
import type { FactKey, ProfileFact } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Money } from "../../ui/index.ts";

type ProfileT = TFunction<"profile">;

/** Подпись факта: у заметки — своя, у ключей PROF-01 — из словаря. */
export function factLabel(t: ProfileT, fact: Pick<ProfileFact, "value">): string {
  return fact.value.key === "note" ? fact.value.label : t(`keys.${fact.value.key}`);
}

export function keyLabel(t: ProfileT, key: FactKey): string {
  return t(`keys.${key}`);
}

/** Дети словами: «2 ребёнка — 17 лет и 9 лет (инвалидность)»; возраст — оценка сервера на сегодня. */
export function childrenText(t: ProfileT, fact: ProfileFact): string {
  if (fact.value.key !== "children") return "";
  const { children } = fact.value;
  if (children.length === 0) return t("value.noChildren");
  const ages = fact.evaluation?.childAges ?? [];
  const parts = children.map((child, index) => {
    const age = ages[index];
    const ageText =
      age === null || age === undefined ? t("value.ageUnknown") : t("value.age", { count: age });
    return child.disability ? t("value.disability", { age: ageText }) : ageText;
  });
  return t("value.childrenWithAges", {
    kids: t("value.children", { count: children.length }),
    ages: parts.join(", "),
  });
}

/** Значение факта словами (сумма — компонентом Money). */
export function factValueNode(t: ProfileT, fact: ProfileFact): ReactNode {
  const { value } = fact;
  const yesNo = (flag: boolean) => (flag ? t("value.yes") : t("value.no"));
  const hasNot = (flag: boolean) => (flag ? t("value.has") : t("value.hasNot"));
  switch (value.key) {
    case "employment":
      return value.types.map((type) => t(`employment.${type}`)).join(", ");
    case "mainEmployer":
      return value.has ? (value.name ?? t("value.has")) : t("value.hasNot");
    case "children":
      return childrenText(t, fact);
    case "familyStatus":
      return value.statuses.length === 0
        ? t("family.none")
        : value.statuses.map((status) => t(`family.${status}`)).join(", ");
    case "largeFamily":
    case "benefitCategory":
      return yesNo(value.value);
    case "housingQueue": {
      const status = t(`housing.${value.status}`);
      return value.since === null
        ? status
        : t("value.since", { value: status, date: formatDate(value.since) });
    }
    case "youngSpecialist":
      return value.until === null
        ? yesNo(value.value)
        : t("value.until", { value: yesNo(value.value), date: formatDate(value.until) });
    case "property.apartment":
    case "property.land":
    case "property.car":
      return hasNot(value.value);
    case "income.salary":
    case "income.regular":
    case "obligations.regular":
      return <Money value={value.amount} />;
    case "note":
      return value.text;
  }
}

export interface FactValueTextProps {
  readonly fact: ProfileFact;
}

export function FactValueText({ fact }: FactValueTextProps) {
  const { t } = useTranslation("profile");
  return <>{factValueNode(t, fact)}</>;
}
