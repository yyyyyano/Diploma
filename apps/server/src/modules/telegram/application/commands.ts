// Быстрые команды бота (TG-07, TG-08, TG-09, LLM-10): `/balance`, `/week`, `/limits`, `/undo`, `/model`, `/password`. Числа — готовые
// ответы фасадов (dashboard, weekly): бот их не считает (P1). Длинное — кратко: подпись, картинка графика, «Открыть на сайте».
import type { ChartData } from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { defineRateRule } from "../../../platform/rate-limit/rate-limit.ts";
import { chartCaption } from "../domain/chart-svg.ts";
import { encodeCallback, modelTag } from "../domain/callback-data.ts";
import { balanceText, limitsText, weekText } from "../domain/commands-text.ts";
import type { TelegramDeps } from "./deps.ts";
import type { BotApi, Keyboard, Origin } from "./ports.ts";
import { makeCategoryNames } from "./category-names.ts";
import { makeSiteLink } from "./site.ts";

/** Окно `/undo` (TG-07): действие через бота не старше суток. */
const UNDO_WINDOW_MS = 24 * 3_600_000;

/** Ссылка сброса — не чаще трёх раз в час на пользователя (SEC-02): токены одноразовые, но не бесплатные. */
const RESET_RULE = defineRateRule({ name: "telegram.reset-link", limit: 3, windowMs: 3_600_000 });

export function makeCommands(d: TelegramDeps) {
  const { t, neighbours, platform } = d;
  const siteLink = makeSiteLink(d);
  const categoryNames = makeCategoryNames(d);

  /** Сообщение с «Открыть на сайте» (кнопкой или ссылкой текстом) и, если есть, картинкой графика. */
  async function reply(
    api: BotApi,
    chatId: number,
    text: string,
    path: string,
    chart?: ChartData,
  ): Promise<void> {
    const site = await siteLink(path);
    if (chart === undefined) {
      await api.send(chatId, text + site.suffix, site.row);
      return;
    }
    // Подпись к картинке — вся информация графика текстом; сообщение с итогом идёт отдельно, ссылка — под картинкой.
    await api.send(chatId, text);
    await api.sendPhoto(
      chatId,
      await d.renderChart(chart),
      chartCaption(chart) + site.suffix,
      site.row,
    );
  }

  async function balance(s: ScopedDb, origin: Origin, api: BotApi): Promise<void> {
    const overview = await neighbours.dashboard.overview(s, {});
    await reply(api, origin.chatId, balanceText(t, overview), "/home");
  }

  async function limits(s: ScopedDb, origin: Origin, api: BotApi): Promise<void> {
    const overview = await neighbours.dashboard.overview(s, {});
    const names = await categoryNames(s);
    const chart: ChartData | undefined =
      overview.limits.length === 0
        ? undefined
        : {
            kind: "bar",
            title: t("bot.limits.chart"),
            unit: "percent",
            currency: null,
            labels: overview.limits.map((limit) => names(limit.categoryKey)),
            series: [
              {
                name: t("bot.limits.chart"),
                values: overview.limits.map((limit) => limit.percent),
              },
            ],
          };
    await reply(
      api,
      origin.chatId,
      limitsText(t, overview.limits, overview.daysLeft, names),
      "/budget",
      chart,
    );
  }

  async function week(s: ScopedDb, origin: Origin, api: BotApi): Promise<void> {
    const summary = await neighbours.weekly.latest(s);
    if (summary === null) {
      await api.send(origin.chatId, t("bot.week.empty"));
      return;
    }
    const currency = summary.spent.amount.currency;
    const chart: ChartData | undefined =
      summary.categories.length === 0
        ? undefined
        : {
            kind: "bar",
            title: t("bot.week.chart"),
            unit: "money",
            currency,
            labels: summary.categories.map((category) => category.name),
            series: [
              {
                name: t("bot.week.chart"),
                values: summary.categories.map((category) => category.amount.amount.minor),
              },
            ],
          };
    await reply(api, origin.chatId, weekText(t, summary), "/home", chart);
  }

  /** `/undo`: последнее действие, сделанное через бот за 24 часа; чужого токена тут нет — его выбирает журнал scope. */
  async function undo(s: ScopedDb, origin: Origin, api: BotApi): Promise<void> {
    const token = await neighbours.actions.lastUndoable(s, "telegram", UNDO_WINDOW_MS);
    if (token === undefined) {
      await api.send(origin.chatId, t("bot.undo.nothing"));
      return;
    }
    await undoToken(s, origin.chatId, token, api);
  }

  /** «Отменить»: общий путь для `/undo` и кнопки уведомления; после отмены «Да» тоже — `actions.undo` одной функцией. */
  async function undoToken(s: ScopedDb, chatId: number, token: string, api: BotApi): Promise<void> {
    try {
      const status = await neighbours.actions.undo(s, token);
      await api.send(chatId, t(status === "undone" ? "bot.undo.done" : "bot.undo.already"));
    } catch (error) {
      if (error instanceof AppError && error.code === "CONFLICT") {
        await api.send(chatId, t("bot.undo.conflict"));
        return;
      }
      throw error;
    }
  }

  /** `/model` (LLM-10): «Авто» или модель из разрешённых; без облачного согласия — только локальные (список даёт `llm`). */
  async function model(s: ScopedDb, origin: Origin, api: BotApi): Promise<void> {
    const { items, selected } = await neighbours.llm.modelChoice.view(s);
    if (items.length === 0) {
      await api.send(origin.chatId, t("bot.model.empty"));
      return;
    }
    const current = items.find((item) => item.id === selected);
    const kindOf = (cloud: boolean) => t(cloud ? "bot.model.cloud" : "bot.model.local");
    const keyboard: Keyboard = [
      [{ text: t("bot.buttons.auto"), data: encodeCallback({ action: "model", id: "auto" }) }],
      ...items.map((item) => [
        {
          text: t("bot.model.label", { model: item.model, kind: kindOf(item.cloud) }),
          data: encodeCallback({ action: "model", id: modelTag(item.id) }),
        },
      ]),
    ];
    const lines = [
      t("bot.model.title"),
      t("bot.model.current", { name: current?.model ?? t("bot.model.auto") }),
      items.some((item) => item.cloud) ? t("bot.model.cloudNote") : t("bot.model.localOnly"),
    ];
    await api.send(origin.chatId, lines.join("\n"), keyboard);
  }

  /** Нажатие в `/model`: метка → модель из актуального списка (устарела — «выберите заново»); итог — в том же сообщении. */
  async function chooseModel(
    s: ScopedDb,
    origin: Origin,
    messageId: number,
    tag: string,
    api: BotApi,
  ): Promise<void> {
    const { items } = await neighbours.llm.modelChoice.view(s);
    const picked = tag === "auto" ? undefined : items.find((item) => modelTag(item.id) === tag);
    if (tag !== "auto" && picked === undefined) {
      await api.edit(origin.chatId, messageId, t("bot.model.unavailable"));
      return;
    }
    try {
      await neighbours.llm.modelChoice.choose(s, picked?.id ?? null);
    } catch (error) {
      if (error instanceof AppError && error.code === "VALIDATION") {
        await api.edit(origin.chatId, messageId, t("bot.model.unavailable"));
        return;
      }
      throw error;
    }
    await api.edit(
      origin.chatId,
      messageId,
      picked === undefined
        ? t("bot.model.chosenAuto")
        : t("bot.model.chosen", { name: picked.model }),
    );
  }

  /** «Сбросить пароль» (TG-09, AUTH-05): новая одноразовая ссылка — по тем же правилам адреса, что письмо (NFR-24). */
  async function resetPassword(s: ScopedDb, origin: Origin, api: BotApi): Promise<void> {
    await platform.rateLimiter.enforce(RESET_RULE, s.scope.userId);
    const { link, minutes } = await neighbours.identity.issueResetLink(s.scope.userId);
    await api.send(origin.chatId, t("bot.reset.link", { link, minutes }));
  }

  return { balance, limits, week, undo, undoToken, model, chooseModel, resetPassword };
}

export type Commands = ReturnType<typeof makeCommands>;
