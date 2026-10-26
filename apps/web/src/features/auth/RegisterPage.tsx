// Регистрация и согласия (design/screens/Register.dc.html; AUTH-01…03, PRIV-01, PRIV-02, SEC-01): email, пароль с
// подсказкой надёжности (≥ 12 символов — SPEC сильнее «от 8» макета), повтор пароля, обязательное согласие на
// обработку ПД с коротким пересказом и ссылкой на политику, отдельная необязательная галочка облачных моделей с
// предупреждением о передаче за рубеж. Кнопка неактивна, пока не выполнено всё обязательное, — рядом сказано, чего не
// хватает. Успех — сервер уже вошёл (cookie): кэш очищается, показывается «Аккаунт создан» и ссылка на локальный ящик.
import { Badge, Button, Checkbox, PasswordInput, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Lock,
  Sparkles,
} from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { AuthLayout } from "./AuthLayout.tsx";
import layout from "./AuthLayout.module.css";
import { checkPassword } from "./model/password-strength.ts";
import { EMPTY_REGISTER, RegisterForm, toRegisterInput } from "./model/register-form.ts";
import classes from "./RegisterPage.module.css";

const SUMMARY = ["data", "purpose", "retention", "rights"] as const;
const RULES = ["length", "mix", "notEmail"] as const;

export function RegisterPage() {
  const { t } = useTranslation(["auth", "policy", "errors"]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ids = { why: useId(), strength: useId(), summary: useId() };
  const mail = useQuery(orpc.mail.status.queryOptions());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; cloud: boolean } | undefined>();
  const form = useForm({
    mode: "controlled",
    initialValues: EMPTY_REGISTER,
    validate: schemaResolver(RegisterForm, { sync: true }),
  });
  const register = useMutation(
    orpc.identity.register.mutationOptions({
      onSuccess: (user) => {
        queryClient.clear();
        setCreated({ email: user.email, cloud: form.values.cloud });
      },
    }),
  );

  if (created !== undefined) {
    return (
      <AuthLayout>
        <div className={layout.card}>
          <CheckCircle2 className={classes.doneIcon} size={40} strokeWidth={1.8} aria-hidden />
          <div className={layout.heading}>
            <h1 className={layout.title}>{t("auth:register.done.title")}</h1>
            <p className={layout.subtitle}>
              {t("auth:register.done.sent", { email: created.email })}
            </p>
          </div>
          <p className={classes.mode}>
            {created.cloud ? t("auth:register.done.modeCloud") : t("auth:register.done.modeLocal")}
          </p>
          <Button size="md" fullWidth onClick={() => void navigate({ to: "/" })}>
            {t("auth:register.done.continue")}
          </Button>
          {mail.data?.mailboxAvailable === true && (
            <Link className={classes.mailbox} to="/mailbox">
              {t("auth:register.done.mailbox")}
            </Link>
          )}
        </div>
      </AuthLayout>
    );
  }

  const { values } = form;
  const strength = checkPassword(values.password, values.email);
  const emailOk = RegisterForm.shape.email.safeParse(values.email.trim()).success;
  const mismatch = values.repeat.length > 0 && values.repeat !== values.password;
  const missing = [
    !emailOk && t("auth:register.missing.email"),
    !strength.ok && t("auth:register.missing.password"),
    strength.ok && values.repeat !== values.password && t("auth:register.missing.repeat"),
    !values.consent && t("auth:register.missing.consent"),
  ].filter((item) => item !== false);
  const ready = missing.length === 0;
  const serverError = register.error === null ? undefined : register.error;

  return (
    <AuthLayout>
      <div className={layout.card}>
        <div className={layout.heading}>
          <h1 className={layout.title}>{t("auth:register.title")}</h1>
          <p className={layout.subtitle}>{t("auth:register.subtitle")}</p>
        </div>
        {serverError !== undefined && (
          <p className={layout.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {t(`errors:${errorCodeOf(serverError)}`, errorParamsOf(serverError))}
          </p>
        )}
        <form
          className={layout.form}
          noValidate
          onSubmit={form.onSubmit((v) => register.mutate(toRegisterInput(v)))}
        >
          <TextInput
            size="md"
            label={t("auth:register.email")}
            placeholder={t("auth:register.emailPlaceholder")}
            description={t("auth:register.emailHint")}
            inputWrapperOrder={["label", "input", "description", "error"]}
            type="email"
            autoComplete="email"
            {...form.getInputProps("email")}
            error={
              values.email.length > 3 && !emailOk ? t("auth:register.emailInvalid") : undefined
            }
          />
          <div className={classes.passwordBlock}>
            <PasswordInput
              size="md"
              label={t("auth:register.password")}
              placeholder={t("auth:register.passwordPlaceholder")}
              autoComplete="new-password"
              aria-describedby={ids.strength}
              visibilityToggleButtonProps={{ "aria-label": t("auth:password.show") }}
              {...form.getInputProps("password")}
              error={undefined}
            />
            <div className={classes.meter} aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={classes.segment}
                  data-level={i < strength.filled ? strength.level : "none"}
                />
              ))}
            </div>
            <div id={ids.strength} className={classes.strength}>
              <p className={classes.strengthRow}>
                <span>{t("auth:register.strength.label")}</span>
                <span className={classes.strengthValue} data-level={strength.level}>
                  {t(`auth:register.strength.${strength.level}`)}
                </span>
              </p>
              <ul className={classes.rules} aria-label={t("auth:register.rules.label")}>
                {RULES.map((rule) => {
                  const done = strength.rules[rule];
                  const Icon = done ? CheckCircle2 : Info;
                  return (
                    <li key={rule} data-done={done}>
                      <Icon size={15} strokeWidth={1.8} aria-hidden />
                      {t(`auth:register.rules.${rule}`)}
                      <span className={classes.srOnly}>
                        {" — "}
                        {done ? t("auth:register.rules.done") : t("auth:register.rules.todo")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <PasswordInput
            size="md"
            label={t("auth:register.repeat")}
            autoComplete="new-password"
            visibilityToggleButtonProps={{ "aria-label": t("auth:password.show") }}
            {...form.getInputProps("repeat")}
            error={mismatch ? t("auth:register.mismatch") : undefined}
          />
          <div className={classes.consent}>
            <Checkbox
              size="md"
              {...form.getInputProps("consent", { type: "checkbox" })}
              error={undefined}
              label={
                <span>
                  {t("auth:register.consent.before")}{" "}
                  <Link to="/policy" target="_blank" rel="noopener">
                    {t("auth:register.consent.link")}
                  </Link>{" "}
                  <Badge variant="light" color="gray" size="sm" className={classes.badge}>
                    {t("auth:register.consent.required")}
                  </Badge>
                </span>
              }
            />
            <button
              type="button"
              className={classes.summaryToggle}
              aria-expanded={summaryOpen}
              aria-controls={ids.summary}
              onClick={() => setSummaryOpen((open) => !open)}
            >
              {summaryOpen ? (
                <ChevronDown size={16} strokeWidth={1.8} aria-hidden />
              ) : (
                <ChevronRight size={16} strokeWidth={1.8} aria-hidden />
              )}
              {t("policy:summary.toggle")}
            </button>
            <dl id={ids.summary} className={classes.summary} hidden={!summaryOpen}>
              {SUMMARY.map((key) => (
                <div key={key}>
                  <dt>{t(`policy:summary.${key}.title`)}</dt>
                  <dd>{t(`policy:summary.${key}.text`)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className={classes.consent}>
            <Checkbox
              size="md"
              {...form.getInputProps("cloud", { type: "checkbox" })}
              label={
                <span>
                  {t("auth:register.cloud.label")}{" "}
                  <Badge variant="light" color="gray" size="sm" className={classes.badge}>
                    {t("auth:register.cloud.optional")}
                  </Badge>
                </span>
              }
              description={t("auth:register.cloud.hint")}
            />
            <p className={classes.warning}>
              <AlertTriangle size={18} strokeWidth={1.8} aria-hidden />
              {t("policy:cloud.warning")}
            </p>
            <p className={classes.mode}>
              {values.cloud ? (
                <Sparkles size={16} strokeWidth={1.8} aria-hidden />
              ) : (
                <Lock size={16} strokeWidth={1.8} aria-hidden />
              )}
              {values.cloud ? t("auth:register.mode.cloud") : t("auth:register.mode.local")}
            </p>
          </div>
          <Button
            type="submit"
            size="md"
            fullWidth
            disabled={!ready}
            loading={register.isPending}
            {...(ready ? {} : { "aria-describedby": ids.why })}
          >
            {t("auth:register.submit")}
          </Button>
          {!ready && (
            <p id={ids.why} className={classes.why}>
              <Info size={16} strokeWidth={1.8} aria-hidden />
              {t("auth:register.why", { list: missing.join(", ") })}
            </p>
          )}
        </form>
        <p className={layout.switch}>
          {t("auth:register.haveAccount")} <Link to="/login">{t("auth:register.signIn")}</Link>
        </p>
      </div>
      <nav className={layout.footer} aria-label={t("auth:footer.label")}>
        <Link to="/policy">{t("auth:footer.policy")}</Link>
      </nav>
    </AuthLayout>
  );
}
