// «Провайдеры ИИ» (ADM-50, LLM-08, LLM-09, NFR-16; Admin.dc.html — Admin--providers): порядок цепочки по задачам со
// включением модели и «Проверить связь», ключи API (поля только для записи — после сохранения «задан»), реестр
// моделей (добавить, возможности, цены, лимиты, разрешённые для выбора). Блок локальных моделей с загрузкой — T-024.
// Вся логика — на сервере: сайт показывает ответ `admin.aiProviders` и шлёт изменения.
import {
  AI_CAPABILITIES,
  AI_TASKS,
  type AiCapability,
  type AiConnectionResult,
  type AiModel,
  type AiProviders,
  type AiTask,
} from "@kosht/contract";
import {
  ActionIcon,
  Button,
  Checkbox,
  NumberInput,
  PasswordInput,
  Switch,
  TextInput,
} from "@mantine/core";
import { Select } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Info, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { SkeletonCard, StatusBadge } from "../../ui/index.ts";
import { dollarsToMicros, microsToDollars } from "./ai-format.ts";
import { LocalModelsCard } from "./LocalModelsCard.tsx";
import { useProviderName } from "./provider-name.ts";
import classes from "./Admin.module.css";

type Keys = "groq" | "zai";

/** Новый ответ сервера — в кэш: все мутации этой вкладки отвечают `AiProviders`. */
function useStore() {
  const queryClient = useQueryClient();
  return (next: AiProviders) => queryClient.setQueryData(orpc.admin.aiProviders.queryKey(), next);
}

function useFailure(error: unknown) {
  const { t } = useTranslation("errors");
  return error === null || error === undefined
    ? undefined
    : t(errorCodeOf(error), errorParamsOf(error));
}

export function AdminAiProvidersPage() {
  const { t } = useTranslation("admin");
  const view = useQuery(orpc.admin.aiProviders.queryOptions());
  if (view.isPending) return <SkeletonCard />;
  if (view.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("ai.providers.error")}
      </p>
    );
  }
  return (
    <>
      <p className={classes.note}>
        <Info size={18} strokeWidth={1.8} aria-hidden />
        {t("ai.providers.info")}
      </p>
      <div className={classes.grid}>
        {AI_TASKS.map((task) => (
          <ChainCard key={task} task={task} view={view.data} />
        ))}
      </div>
      <div className={classes.grid}>
        <KeysCard view={view.data} />
        <LocalModelsCard />
      </div>
      <RegistryCard view={view.data} />
    </>
  );
}

function ChainCard({ task, view }: { readonly task: AiTask; readonly view: AiProviders }) {
  const { t } = useTranslation("admin");
  const store = useStore();
  const chain = view.chains.find((item) => item.task === task);
  const save = useMutation(orpc.admin.setAiChain.mutationOptions({ onSuccess: store }));
  const failure = useFailure(save.error);
  const models = (chain?.models ?? []).flatMap((id) => view.models.find((m) => m.id === id) ?? []);
  function move(index: number, by: -1 | 1) {
    const ids = models.map((model) => model.id);
    const target = index + by;
    const moved = ids[index];
    const other = ids[target];
    if (moved === undefined || other === undefined) return;
    ids[index] = other;
    ids[target] = moved;
    save.mutate({ task, models: ids });
  }
  return (
    <section className={classes.card} aria-labelledby={`admin-chain-${task}`}>
      <div className={classes.cardHead}>
        <h2 id={`admin-chain-${task}`} className={classes.cardTitle}>
          {t(`ai.tasks.${task}.title`)}
        </h2>
        <p className={classes.hint}>{t(`ai.tasks.${task}.hint`)}</p>
      </div>
      <ol className={classes.chain}>
        {models.map((model, index) => (
          <ChainRow
            key={model.id}
            model={model}
            position={index + 1}
            last={index === models.length - 1}
            busy={save.isPending}
            onMove={(by) => move(index, by)}
          />
        ))}
      </ol>
      {failure !== undefined && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {failure}
        </p>
      )}
    </section>
  );
}

function ChainRow(props: {
  readonly model: AiModel;
  readonly position: number;
  readonly last: boolean;
  readonly busy: boolean;
  readonly onMove: (by: -1 | 1) => void;
}) {
  const { model, position } = props;
  const { t } = useTranslation("admin");
  const providerName = useProviderName();
  const store = useStore();
  const enable = useMutation(orpc.admin.setAiModelEnabled.mutationOptions({ onSuccess: store }));
  const test = useMutation(orpc.admin.testAiProvider.mutationOptions());
  const name = `${providerName(model.provider)} · ${model.model}`;
  return (
    <li className={classes.chainRow}>
      <span className={classes.position} aria-label={t("ai.providers.position", { position })}>
        {position}
      </span>
      <div className={classes.chainText}>
        <strong>{providerName(model.provider)}</strong>
        <span className={classes.hint}>
          {model.model} · {model.cloud ? t("ai.providers.cloud") : t("ai.providers.local")}
        </span>
      </div>
      <Switch
        checked={model.enabled}
        disabled={enable.isPending}
        aria-label={t("ai.providers.enabled", { model: name })}
        onChange={(event) => enable.mutate({ id: model.id, enabled: event.currentTarget.checked })}
      />
      <div className={classes.chainActions}>
        <span className={classes.hint} aria-live="polite">
          <ConnectionText result={test.data} pending={test.isPending} failed={test.isError} />
        </span>
        <ActionIcon
          variant="subtle"
          disabled={props.busy || position === 1}
          aria-label={t("ai.providers.up", { model: name })}
          onClick={() => props.onMove(-1)}
        >
          <ChevronUp size={16} strokeWidth={1.8} aria-hidden />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          disabled={props.busy || props.last}
          aria-label={t("ai.providers.down", { model: name })}
          onClick={() => props.onMove(1)}
        >
          <ChevronDown size={16} strokeWidth={1.8} aria-hidden />
        </ActionIcon>
        <Button
          variant="default"
          size="xs"
          loading={test.isPending}
          aria-label={`${t("ai.providers.test")}: ${name}`}
          onClick={() => test.mutate({ id: model.id })}
        >
          {t("ai.providers.test")}
        </Button>
      </div>
    </li>
  );
}

function ConnectionText(props: {
  readonly result: AiConnectionResult | undefined;
  readonly pending: boolean;
  readonly failed: boolean;
}) {
  const { t } = useTranslation("admin");
  if (props.pending) return <>{t("ai.providers.testing")}</>;
  if (props.failed) return <>{t("ai.providers.testReasons.unreachable")}</>;
  if (props.result === undefined) return <>{t("ai.providers.notTested")}</>;
  return props.result.ok ? (
    <>{t("ai.providers.testOk", { ms: props.result.ms })}</>
  ) : (
    <>{t(`ai.providers.testReasons.${props.result.reason}`)}</>
  );
}

function KeysCard({ view }: { readonly view: AiProviders }) {
  const { t } = useTranslation("admin");
  const keyed = view.providers.flatMap((provider) =>
    provider.key === "none" || (provider.id !== "groq" && provider.id !== "zai") ? [] : [provider],
  );
  return (
    <section className={classes.card} aria-labelledby="admin-keys">
      <div>
        <h2 id="admin-keys" className={classes.cardTitle}>
          {t("ai.providers.keys.title")}
        </h2>
        <p className={classes.hint}>{t("ai.providers.keys.hint")}</p>
      </div>
      {keyed.map((provider) => (
        <KeyRow
          key={provider.id}
          provider={provider.id as Keys}
          status={provider.key as "set" | "unset" | "unreadable"}
        />
      ))}
    </section>
  );
}

function KeyRow({
  provider,
  status,
}: {
  readonly provider: Keys;
  readonly status: "set" | "unset" | "unreadable";
}) {
  const { t } = useTranslation("admin");
  const store = useStore();
  const providerName = useProviderName();
  const [value, setValue] = useState("");
  const [done, setDone] = useState<"saved" | "cleared" | undefined>();
  const name = providerName(provider);
  const save = useMutation(
    orpc.admin.setAiKey.mutationOptions({
      onSuccess: (next, input) => {
        store(next);
        setValue("");
        setDone(input.key === null ? "cleared" : "saved");
      },
    }),
  );
  const failure = useFailure(save.error);
  return (
    <form
      className={classes.keyRow}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== "") save.mutate({ provider, key: value });
      }}
    >
      <div className={classes.cardHead}>
        <strong>{name}</strong>
        <StatusBadge
          tone={status === "set" ? "ok" : status === "unreadable" ? "danger" : "warn"}
          icon={status === "set" ? CheckCircle2 : AlertCircle}
        >
          {t(`ai.providers.keys.${status}`)}
        </StatusBadge>
      </div>
      <PasswordInput
        label={t("ai.providers.keys.label", { provider: name })}
        autoComplete="off"
        placeholder={
          status === "set"
            ? t("ai.providers.keys.placeholderSet")
            : t("ai.providers.keys.placeholderUnset")
        }
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className={classes.actions}>
        <Button type="submit" disabled={value === ""} loading={save.isPending}>
          {t("ai.providers.keys.save", { provider: name })}
        </Button>
        {status === "set" && (
          <Button
            variant="default"
            loading={save.isPending}
            onClick={() => save.mutate({ provider, key: null })}
          >
            {t("ai.providers.keys.clear", { provider: name })}
          </Button>
        )}
      </div>
      {done !== undefined && !save.isError && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t(`ai.providers.keys.${done}`, { provider: name })}
        </output>
      )}
      {failure !== undefined && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {failure}
        </p>
      )}
    </form>
  );
}

interface ModelForm {
  provider: string;
  model: string;
  capabilities: AiCapability[];
  priority: number;
  contextTokens: number;
  input: string;
  output: string;
  rpm: number | "";
  tpm: number | "";
  rpd: number | "";
  tpd: number | "";
  userSelectable: boolean;
}

const EMPTY_FORM: ModelForm = {
  provider: "",
  model: "",
  capabilities: ["text"],
  priority: 100,
  contextTokens: 0,
  input: "0",
  output: "0",
  rpm: "",
  tpm: "",
  rpd: "",
  tpd: "",
  userSelectable: false,
};

function formOf(model: AiModel): ModelForm {
  return {
    provider: model.provider,
    model: model.model,
    capabilities: [...model.capabilities],
    priority: model.priority,
    contextTokens: model.contextTokens,
    input: microsToDollars(model.inputMicrosPerMillion),
    output: microsToDollars(model.outputMicrosPerMillion),
    rpm: model.limits.rpm ?? "",
    tpm: model.limits.tpm ?? "",
    rpd: model.limits.rpd ?? "",
    tpd: model.limits.tpd ?? "",
    userSelectable: model.userSelectable,
  };
}

const limitOf = (value: number | "") => (value === "" ? null : value);

function RegistryCard({ view }: { readonly view: AiProviders }) {
  const { t } = useTranslation("admin");
  const providerName = useProviderName();
  const store = useStore();
  const [form, setForm] = useState<ModelForm>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | undefined>();
  const save = useMutation(
    orpc.admin.saveAiModel.mutationOptions({
      onSuccess: (next, input) => {
        store(next);
        setSaved(input.model);
        setEditing(false);
        setForm(EMPTY_FORM);
      },
    }),
  );
  const failure = useFailure(save.error);
  const providers = view.providers.filter((provider) => provider.id !== "test");
  const input = dollarsToMicros(form.input);
  const output = dollarsToMicros(form.output);
  const valid =
    form.provider !== "" &&
    form.model.trim() !== "" &&
    form.capabilities.length > 0 &&
    input !== undefined &&
    output !== undefined;

  /** Разрешить или запретить выбор в чате — остальные поля записи сохраняются как есть. */
  function toggleSelectable(model: AiModel, userSelectable: boolean) {
    save.mutate({
      provider: model.provider,
      model: model.model,
      capabilities: model.capabilities,
      priority: model.priority,
      userSelectable,
      contextTokens: model.contextTokens,
      inputMicrosPerMillion: model.inputMicrosPerMillion,
      outputMicrosPerMillion: model.outputMicrosPerMillion,
      limits: model.limits,
    });
  }

  return (
    <section className={classes.card} aria-labelledby="admin-registry">
      <div>
        <h2 id="admin-registry" className={classes.cardTitle}>
          {t("ai.providers.registry.title")}
        </h2>
        <p className={classes.hint}>{t("ai.providers.registry.hint")}</p>
      </div>
      <table className={`${classes.table} ${classes.stack}`}>
        <thead>
          <tr>
            <th scope="col">{t("ai.providers.registry.model")}</th>
            <th scope="col">{t("ai.providers.registry.capabilities")}</th>
            <th scope="col">{t("ai.providers.registry.selectable")}</th>
            <th scope="col">
              <span className={classes.srOnly}>{t("ai.providers.registry.formEdit")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.models.map((model) => {
            const name = `${providerName(model.provider)} · ${model.model}`;
            return (
              <tr key={model.id}>
                <th scope="row">
                  {name}
                  <span className={classes.hint}>
                    {" "}
                    · {model.cloud ? t("ai.providers.cloud") : t("ai.providers.local")}
                  </span>
                </th>
                <td data-label={t("ai.providers.registry.capabilities")}>
                  {model.capabilities
                    .map((capability) => t(`ai.providers.registry.capabilityNames.${capability}`))
                    .join(", ")}
                </td>
                <td data-label={t("ai.providers.registry.selectable")}>
                  <Switch
                    checked={model.userSelectable}
                    disabled={save.isPending || model.provider === "test"}
                    aria-label={t("ai.providers.registry.selectableLabel", { model: name })}
                    onChange={(event) => toggleSelectable(model, event.currentTarget.checked)}
                  />
                </td>
                <td>
                  <ActionIcon
                    variant="subtle"
                    disabled={model.provider === "test"}
                    aria-label={t("ai.providers.registry.edit", { model: name })}
                    onClick={() => {
                      setForm(formOf(model));
                      setEditing(true);
                      setSaved(undefined);
                    }}
                  >
                    <Pencil size={16} strokeWidth={1.8} aria-hidden />
                  </ActionIcon>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <form
        className={classes.modelForm}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || input === undefined || output === undefined) return;
          save.mutate({
            provider: form.provider,
            model: form.model.trim(),
            capabilities: form.capabilities,
            priority: form.priority,
            userSelectable: form.userSelectable,
            contextTokens: form.contextTokens,
            inputMicrosPerMillion: input,
            outputMicrosPerMillion: output,
            limits: {
              rpm: limitOf(form.rpm),
              tpm: limitOf(form.tpm),
              rpd: limitOf(form.rpd),
              tpd: limitOf(form.tpd),
            },
          });
        }}
      >
        <h3 className={classes.subTitle}>
          {editing ? t("ai.providers.registry.formEdit") : t("ai.providers.registry.formAdd")}
        </h3>
        <div className={classes.fields}>
          <Select
            label={t("ai.providers.registry.formProvider")}
            data={providers.map((provider) => ({
              value: provider.id,
              label: providerName(provider.id),
            }))}
            value={form.provider === "" ? null : form.provider}
            allowDeselect={false}
            disabled={editing}
            onChange={(value) => setForm({ ...form, provider: value ?? "" })}
          />
          <TextInput
            label={t("ai.providers.registry.formModel")}
            autoComplete="off"
            disabled={editing}
            value={form.model}
            onChange={(event) => setForm({ ...form, model: event.currentTarget.value })}
          />
          <NumberInput
            label={t("ai.providers.registry.formPriority")}
            min={0}
            max={10_000}
            allowDecimal={false}
            value={form.priority}
            onChange={(value) => setForm({ ...form, priority: Number(value) })}
          />
          <NumberInput
            label={t("ai.providers.registry.formContext")}
            min={0}
            allowDecimal={false}
            value={form.contextTokens}
            onChange={(value) => setForm({ ...form, contextTokens: Number(value) })}
          />
          <TextInput
            label={t("ai.providers.registry.formInput")}
            inputMode="decimal"
            error={input === undefined ? " " : undefined}
            value={form.input}
            onChange={(event) => setForm({ ...form, input: event.currentTarget.value })}
          />
          <TextInput
            label={t("ai.providers.registry.formOutput")}
            inputMode="decimal"
            error={output === undefined ? " " : undefined}
            value={form.output}
            onChange={(event) => setForm({ ...form, output: event.currentTarget.value })}
          />
        </div>
        <fieldset className={classes.fieldset}>
          <legend>{t("ai.providers.registry.formCapabilities")}</legend>
          {AI_CAPABILITIES.map((capability) => (
            <Checkbox
              key={capability}
              label={t(`ai.providers.registry.capabilityNames.${capability}`)}
              checked={form.capabilities.includes(capability)}
              onChange={(event) =>
                setForm({
                  ...form,
                  capabilities: event.currentTarget.checked
                    ? [...form.capabilities, capability]
                    : form.capabilities.filter((item) => item !== capability),
                })
              }
            />
          ))}
        </fieldset>
        <fieldset className={classes.fieldset}>
          <legend>{t("ai.providers.registry.formLimits")}</legend>
          <div className={classes.fields}>
            {(["rpm", "tpm", "rpd", "tpd"] as const).map((key) => (
              <NumberInput
                key={key}
                label={t(`ai.providers.registry.${key}`)}
                min={1}
                allowDecimal={false}
                value={form[key]}
                onChange={(value) => setForm({ ...form, [key]: value === "" ? "" : Number(value) })}
              />
            ))}
          </div>
        </fieldset>
        <Checkbox
          label={t("ai.providers.registry.selectableToggle")}
          checked={form.userSelectable}
          onChange={(event) => setForm({ ...form, userSelectable: event.currentTarget.checked })}
        />
        <div className={classes.actions}>
          <Button type="submit" disabled={!valid} loading={save.isPending}>
            {t("ai.providers.registry.save")}
          </Button>
          {editing && (
            <Button
              variant="default"
              onClick={() => {
                setEditing(false);
                setForm(EMPTY_FORM);
              }}
            >
              {t("ai.providers.registry.cancel")}
            </Button>
          )}
        </div>
        {saved !== undefined && !save.isError && (
          <output className={classes.ok}>
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
            {t("ai.providers.registry.saved", { model: saved })}
          </output>
        )}
        {failure !== undefined && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {failure}
          </p>
        )}
      </form>
    </section>
  );
}
