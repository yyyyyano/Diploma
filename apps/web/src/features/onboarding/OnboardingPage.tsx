// Анкета на 1 минуту (design/screens/Onboarding.dc.html, AUTH-07, PROF-02): шесть вопросов после первого входа, каждый
// пропускается; «Пропустить анкету» — сразу на главную. «Готово» сохраняет отвеченное фактами «анкета»
// (profile.completeOnboarding) и показывает «Вот что я запомнил»; «Изменить» возвращает к вопросу. Признак «анкета
// пройдена или пропущена» хранит сервер — второй раз анкета не показывается.
import type { FactKey, OnboardingAnswers, ProfileFact } from "@kosht/contract";
import { Button, Checkbox, NumberInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Baby,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  House,
  Info,
  Minus,
  Plus,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { factValueNode, keyLabel } from "../../entities/profile-fact/index.ts";
import { orpc } from "../../lib/api.ts";
import { cx } from "../../ui/cx.ts";
import { Logo } from "../../ui/index.ts";
import classes from "./OnboardingPage.module.css";

const QUESTIONS = ["employment", "children", "housing", "benefit", "young", "family"] as const;
type Question = (typeof QUESTIONS)[number];

/** Ключ факта и значок строки итога по вопросу. */
const SUMMARY: Record<Question, { key: FactKey; icon: LucideIcon }> = {
  employment: { key: "employment", icon: BriefcaseBusiness },
  children: { key: "children", icon: Baby },
  housing: { key: "housingQueue", icon: House },
  benefit: { key: "benefitCategory", icon: Shield },
  young: { key: "youngSpecialist", icon: GraduationCap },
  family: { key: "familyStatus", icon: Users },
};

const EMPLOYMENT = ["employee", "npd", "ip", "unemployed", "pensioner", "student"] as const;
const HOUSING = ["now", "before", "no", "unknown"] as const;
const FAMILY = ["singleParent", "widowed", "guardian", "fosterParent", "none"] as const;
const MAX_KIDS = 6;

interface Kid {
  readonly age: number | null;
  readonly disability: boolean;
}

interface State {
  readonly employment: readonly string[];
  readonly kids: readonly Kid[];
  readonly housing: string | null;
  readonly benefit: boolean | null;
  readonly young: boolean | null;
  readonly family: readonly string[];
}

const START: State = {
  employment: [],
  kids: [],
  housing: null,
  benefit: null,
  young: null,
  family: [],
};

function hasAnswer(question: Question, state: State): boolean {
  switch (question) {
    case "employment":
      return state.employment.length > 0;
    case "children":
      return true;
    case "housing":
      return state.housing !== null;
    case "benefit":
      return state.benefit !== null;
    case "young":
      return state.young !== null;
    case "family":
      return state.family.length > 0;
  }
}

/** Ответы для сервера: только отвеченные вопросы (пропущенный — нет поля). */
export function answersOf(state: State, answered: ReadonlySet<Question>): OnboardingAnswers {
  const answers: Record<string, unknown> = {};
  if (answered.has("employment")) answers["employment"] = state.employment;
  if (answered.has("children")) {
    answers["children"] = state.kids.map((kid) => ({ age: kid.age, disability: kid.disability }));
  }
  if (answered.has("housing")) answers["housingQueue"] = state.housing;
  if (answered.has("benefit")) answers["benefitCategory"] = state.benefit;
  if (answered.has("young")) answers["youngSpecialist"] = state.young;
  if (answered.has("family")) answers["familyStatus"] = state.family.filter((x) => x !== "none");
  return answers as OnboardingAnswers;
}

export function OnboardingPage() {
  const { t } = useTranslation("profile");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<State>(START);
  const [answered, setAnswered] = useState<ReadonlySet<Question>>(new Set());
  const [saved, setSaved] = useState<readonly ProfileFact[] | null>(null);
  const complete = useMutation(
    orpc.profile.completeOnboarding.mutationOptions({
      onSuccess: async ({ facts }) => {
        await queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
        setSaved(facts);
      },
    }),
  );
  const skipAll = useMutation(
    orpc.profile.completeOnboarding.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
        await navigate({ to: "/" });
      },
    }),
  );

  const question = QUESTIONS[Math.min(step, QUESTIONS.length - 1)] ?? "employment";
  const showSummary = saved !== null && step >= QUESTIONS.length;
  const go = (next: number, mark?: "answered" | "skipped") => {
    const nextAnswered = new Set(answered);
    if (mark === "answered") nextAnswered.add(question);
    if (mark === "skipped") nextAnswered.delete(question);
    setAnswered(nextAnswered);
    setStep(next);
    if (next >= QUESTIONS.length) complete.mutate({ answers: answersOf(state, nextAnswered) });
  };

  return (
    <div className={classes.wrap}>
      <header className={classes.top}>
        <Logo />
        <span className={classes.topTitle}>{t("onboarding.pageTitle")}</span>
        {!showSummary && (
          <Button
            variant="subtle"
            loading={skipAll.isPending}
            onClick={() => skipAll.mutate({ answers: {} })}
          >
            {t("onboarding.skipAll")}
          </Button>
        )}
      </header>
      <main className={classes.main}>
        {(complete.isError || skipAll.isError) && (
          <p className={classes.error} role="alert">
            <AlertTriangle size={18} aria-hidden />
            {t("onboarding.error")}
          </p>
        )}
        {showSummary ? (
          <Summary facts={saved} onEdit={(index) => setStep(index)} />
        ) : (
          <QuestionView
            index={Math.min(step, QUESTIONS.length - 1)}
            question={question}
            state={state}
            onChange={(next) => setState((current) => ({ ...current, ...next }))}
            pending={complete.isPending}
            onBack={() => setStep(Math.max(0, step - 1))}
            onSkip={() => go(step + 1, "skipped")}
            onNext={() => go(step + 1, "answered")}
          />
        )}
      </main>
    </div>
  );
}

function QuestionView({
  index,
  question,
  state,
  onChange,
  pending,
  onBack,
  onSkip,
  onNext,
}: {
  readonly index: number;
  readonly question: Question;
  readonly state: State;
  readonly onChange: (next: Partial<State>) => void;
  readonly pending: boolean;
  readonly onBack: () => void;
  readonly onSkip: () => void;
  readonly onNext: () => void;
}) {
  const { t } = useTranslation("profile");
  const last = index === QUESTIONS.length - 1;
  const titleId = "onboarding-question";
  const note =
    question === "employment" ||
    question === "children" ||
    question === "young" ||
    question === "family"
      ? t(`onboarding.questions.${question}.note`)
      : null;
  return (
    <section className={classes.column} aria-labelledby={titleId}>
      <div className={classes.progressHead}>
        <span className={classes.progressLabel}>
          {t("onboarding.progress", { n: index + 1, total: QUESTIONS.length })}
        </span>
        <span className={classes.muted}>
          {last ? t("onboarding.lastQuestion") : t("onboarding.timeLeft")}
        </span>
      </div>
      <progress className={classes.progress} max={QUESTIONS.length} value={index + 1} aria-hidden />
      {index === 0 && <p className={classes.intro}>{t("onboarding.intro")}</p>}
      <h1 id={titleId} className={classes.title}>
        {t(`onboarding.questions.${question}.title`)}
      </h1>
      {note !== null && <p className={classes.muted}>{note}</p>}
      <p className={classes.why}>
        <Info size={16} aria-hidden className={classes.whyIcon} />
        <span>
          <strong>{t("onboarding.whyTitle")}</strong> {t(`onboarding.questions.${question}.why`)}
        </span>
      </p>
      {question === "employment" && (
        <Options
          multi
          legend={t("onboarding.questions.employment.title")}
          options={EMPLOYMENT.map((value) => ({
            value,
            label: t(`employment.${value}`),
            hint:
              value === "employee" || value === "npd" || value === "ip"
                ? t(`employmentHint.${value}`)
                : null,
          }))}
          selected={state.employment}
          onChange={(employment) => onChange({ employment })}
        />
      )}
      {question === "children" && (
        <Kids kids={state.kids} onChange={(kids) => onChange({ kids })} />
      )}
      {question === "housing" && (
        <Options
          legend={t("onboarding.questions.housing.title")}
          options={HOUSING.map((value) => ({
            value,
            label: t(`housing.${value}`),
            hint: value === "no" ? null : t(`housingHint.${value}`),
          }))}
          selected={state.housing === null ? [] : [state.housing]}
          onChange={([housing]) => onChange({ housing: housing ?? null })}
        />
      )}
      {question === "benefit" && (
        <Options
          legend={t("onboarding.questions.benefit.title")}
          options={[
            {
              value: "yes",
              label: t("onboarding.questions.benefit.yes"),
              hint: t("onboarding.questions.benefit.yesHint"),
            },
            { value: "no", label: t("value.no"), hint: null },
          ]}
          selected={state.benefit === null ? [] : [state.benefit ? "yes" : "no"]}
          onChange={([value]) => onChange({ benefit: value === "yes" })}
        />
      )}
      {question === "young" && (
        <Options
          legend={t("onboarding.questions.young.title")}
          options={[
            { value: "yes", label: t("value.yes"), hint: null },
            { value: "no", label: t("value.no"), hint: null },
          ]}
          selected={state.young === null ? [] : [state.young ? "yes" : "no"]}
          onChange={([value]) => onChange({ young: value === "yes" })}
        />
      )}
      {question === "family" && (
        <Options
          multi
          legend={t("onboarding.questions.family.title")}
          options={FAMILY.map((value) => ({ value, label: t(`family.${value}`), hint: null }))}
          selected={state.family}
          onChange={(family, picked) =>
            onChange({
              family:
                picked === "none"
                  ? family.filter((x) => x === "none")
                  : family.filter((x) => x !== "none"),
            })
          }
        />
      )}
      <div className={classes.nav}>
        <Button
          variant="subtle"
          leftSection={<ChevronLeft size={18} aria-hidden />}
          disabled={index === 0}
          onClick={onBack}
        >
          {t("onboarding.back")}
        </Button>
        <span className={classes.navRight}>
          <Button variant="subtle" onClick={onSkip}>
            {t("onboarding.skip")}
          </Button>
          <Button
            rightSection={<ChevronRight size={18} aria-hidden />}
            disabled={!hasAnswer(question, state)}
            loading={pending}
            onClick={onNext}
          >
            {last ? t("onboarding.done") : t("onboarding.next")}
          </Button>
        </span>
      </div>
    </section>
  );
}

interface Option {
  readonly value: string;
  readonly label: string;
  readonly hint: string | null;
}

/** Варианты ответа карточками: один (радио) или несколько (флажки). */
function Options({
  legend,
  options,
  selected,
  multi = false,
  onChange,
}: {
  readonly legend: string;
  readonly options: readonly Option[];
  readonly selected: readonly string[];
  readonly multi?: boolean;
  readonly onChange: (selected: string[], picked: string) => void;
}) {
  const pick = (value: string) => {
    if (!multi) {
      onChange([value], value);
      return;
    }
    onChange(
      selected.includes(value) ? selected.filter((x) => x !== value) : [...selected, value],
      value,
    );
  };
  return (
    <fieldset className={classes.options}>
      <legend className={classes.srOnly}>{legend}</legend>
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <label key={option.value} className={cx(classes.option, on && classes.optionOn)}>
            <input
              type={multi ? "checkbox" : "radio"}
              name="onboarding-answer"
              className={classes.input}
              checked={on}
              onChange={() => pick(option.value)}
            />
            <span className={classes.optionText}>
              <span className={classes.optionLabel}>{option.label}</span>
              {option.hint !== null && <span className={classes.optionHint}>{option.hint}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function Kids({
  kids,
  onChange,
}: {
  readonly kids: readonly Kid[];
  readonly onChange: (kids: readonly Kid[]) => void;
}) {
  const { t } = useTranslation("profile");
  const setCount = (count: number) => {
    const next = kids.slice(0, count);
    while (next.length < count) next.push({ age: null, disability: false });
    onChange(next);
  };
  const update = (index: number, patch: Partial<Kid>) =>
    onChange(kids.map((kid, i) => (i === index ? { ...kid, ...patch } : kid)));
  return (
    <div className={classes.kids}>
      <div className={classes.counterRow}>
        <fieldset className={classes.counter}>
          <legend className={classes.srOnly}>{t("onboarding.questions.children.count")}</legend>
          <button
            type="button"
            className={classes.counterButton}
            aria-label={t("onboarding.questions.children.less")}
            disabled={kids.length === 0}
            onClick={() => setCount(kids.length - 1)}
          >
            <Minus size={18} aria-hidden />
          </button>
          <output className={classes.counterValue}>{kids.length}</output>
          <button
            type="button"
            className={classes.counterButton}
            aria-label={t("onboarding.questions.children.more")}
            disabled={kids.length >= MAX_KIDS}
            onClick={() => setCount(kids.length + 1)}
          >
            <Plus size={18} aria-hidden />
          </button>
        </fieldset>
        <span className={classes.muted}>
          {kids.length === 0 ? t("value.noChildren") : t("value.children", { count: kids.length })}
        </span>
      </div>
      {kids.map((kid, index) => {
        const n = index + 1;
        return (
          <fieldset key={n} className={classes.kid}>
            <legend className={classes.kidTitle}>{t("editor.childTitle", { n })}</legend>
            <NumberInput
              label={t("editor.childAge")}
              min={0}
              max={40}
              allowDecimal={false}
              value={kid.age ?? ""}
              onChange={(age) => update(index, { age: typeof age === "number" ? age : null })}
              className={classes.age}
            />
            <Checkbox
              label={t("editor.childDisability")}
              checked={kid.disability}
              onChange={(event) => update(index, { disability: event.currentTarget.checked })}
            />
          </fieldset>
        );
      })}
      <p className={classes.muted}>{t("onboarding.questions.children.hint")}</p>
    </div>
  );
}

function Summary({
  facts,
  onEdit,
}: {
  readonly facts: readonly ProfileFact[];
  readonly onEdit: (index: number) => void;
}) {
  const { t } = useTranslation("profile");
  return (
    <section className={classes.column} aria-labelledby="onboarding-summary">
      <h1 id="onboarding-summary" className={classes.title}>
        {t("onboarding.summary.title")}
      </h1>
      <p className={classes.muted}>{t("onboarding.summary.text")}</p>
      <ul className={classes.summary}>
        {QUESTIONS.map((question, index) => {
          const { key, icon: Icon } = SUMMARY[question];
          const fact = facts.find((item) => item.value.key === key);
          const label = keyLabel(t, key);
          return (
            <li key={question} className={classes.summaryRow}>
              <span
                className={cx(classes.summaryIcon, fact === undefined && classes.summaryIconOff)}
              >
                <Icon size={18} aria-hidden />
              </span>
              <span className={classes.summaryText}>
                <span className={classes.optionHint}>{label}</span>
                <span className={fact === undefined ? classes.muted : classes.summaryValue}>
                  {fact === undefined ? t("onboarding.summary.later") : factValueNode(t, fact)}
                </span>
              </span>
              <Button
                variant="subtle"
                size="sm"
                aria-label={t("onboarding.summary.edit", { label })}
                onClick={() => onEdit(index)}
              >
                {t("onboarding.summary.editShort")}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className={classes.muted}>{t("onboarding.summary.property")}</p>
      <p className={classes.muted}>
        {t("onboarding.summary.memoryLead")}{" "}
        <Link to="/memory" className={classes.link}>
          {t("onboarding.summary.memoryLink")}
        </Link>
      </p>
      <div className={classes.nav}>
        <Button component={Link} to="/">
          {t("onboarding.summary.home")}
        </Button>
      </div>
    </section>
  );
}
