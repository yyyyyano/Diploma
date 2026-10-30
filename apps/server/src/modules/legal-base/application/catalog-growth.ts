// Пополнение каталога (LAW-11…17): граф ссылок на 1 шаг от загруженных актов, «Новые поступления» за все пропущенные дни
// (≤ 30), ведомственные страницы раз в месяц, журнал спроса и недельная сводка. Все найденные — кандидаты (`legal_candidates`):
// фильтры без модели (LAW-13) → тема по рубрикам ЕПК (LAW-14) → модель только для спорных → маршрут LAW-17 (индекс, карточка,
// очередь администратора или отсев с причиной). Изменяющий акт из новых поступлений — не запись каталога, а повод внепланово
// проверить изменяемые акты (LAW-12). Все запросы к сайтам — через вежливые загрузчики; проход идёт ночью (LAW-35).
import { LocalDate, type Clock } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { prefilter } from "../domain/relevance.ts";
import { requisitesIn } from "../domain/requisites.ts";
import { routeOf } from "../domain/routes.ts";
import {
  isTopic,
  topicOfOrgan,
  topicOfRubrics,
  topicOfTitle,
  type Topic,
} from "../domain/topics.ts";
import {
  actsAwaitingText,
  actsByPravoIds,
  actsToScanLinks,
  addAct,
  addDemand,
  addFoundCandidates,
  currentSnapshotHtml,
  decideCandidate,
  demandSince,
  enableText,
  foundCandidates,
  markLinksScanned,
  markTextChecked,
  queueCandidate,
  readMark,
  requeueCandidate,
  writeMark,
  type CandidateRow,
} from "../infrastructure/db/growth.repo.ts";
import { logUpdate, markActState } from "../infrastructure/db/catalog.repo.ts";
import { parseArrivals } from "../infrastructure/pravo-by/parse-arrivals.ts";
import { parseCard } from "../infrastructure/pravo-by/parse-card.ts";
import { pravoLinksIn } from "../infrastructure/pravo-by/parse-links.ts";
import { parseRubrics } from "../infrastructure/pravo-by/parse-rubrics.ts";
import { PRAVO_ID } from "../infrastructure/pravo-by/pravo-source.ts";
import { readActPage } from "../infrastructure/pravo-by/read-page.ts";
import type { ActCheck } from "./act-check.ts";
import type { Embedder } from "./embed.ts";
import type { LoadAct } from "./load-act.ts";
import {
  ActTextNotFound,
  LoaderStopped,
  RobotsDenied,
  SourceUnavailable,
  type AgencySource,
  type DiscoverySource,
  type LegalSource,
  type RegistrySource,
} from "./ports.ts";
import {
  AGENCY_PAGES,
  EPK_TOPICS,
  FILTER_TITLE_PATTERNS,
  GROWTH_BATCH,
  NEW_ACTS_MODE,
  TEXT_CHECK_WEEKS,
} from "../settings.ts";

type FullSource = LegalSource & RegistrySource & DiscoverySource;

export interface GrowthDeps {
  readonly system: SystemDb;
  readonly source: () => Promise<FullSource>;
  readonly agencies: AgencySource;
  readonly loadAct: LoadAct;
  readonly actCheck: Pick<ActCheck, "checkCard" | "checkText">;
  /** Модель (`systemCaller`, облачная цепочка — данных пользователя нет, PRIV-09): тема акта по заголовку; null — не про деньги. */
  readonly classify: (title: string) => Promise<Topic | null>;
  readonly embedder: Pick<Embedder, "run">;
  readonly settings: Pick<Settings, "get">;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
}

const DAY_MS = 86_400_000;
/** Не дальше этого числа дней назад читаются пропущенные «Новые поступления» (LAW-12). */
export const MAX_ARRIVAL_DAYS = 30;
const AGENCY_PERIOD_DAYS = 30;
const SUMMARY_PERIOD_DAYS = 7;
const MARK_ARRIVALS = "arrivals-day";
const MARK_AGENCIES = "agencies";
const MARK_SUMMARY = "demand-summary";

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Вид акта для каталога по строке «Закон …», «Указ …», «Постановление Пленума …». */
export function kindOfLine(line: string): string {
  const text = line.trim().toLowerCase();
  if (text.startsWith("закон")) return "law";
  if (text.startsWith("кодекс")) return "code";
  if (text.startsWith("указ")) return "decree";
  if (text.includes("пленум")) return "plenum";
  return "resolution";
}

type Verdict = "decided" | "later";

export function makeCatalogGrowth(d: GrowthDeps) {
  /** Отсев: запись кандидата и строка журнала с причиной (LAW-13: причина каждого отсева видна). */
  async function drop(c: CandidateRow, reason: string, extra: Record<string, string> = {}) {
    await decideCandidate(d.system, c.id, { status: "dropped", reason }, d.clock.now());
    await logUpdate(d.system, {
      at: d.clock.now(),
      actId: null,
      event: "candidate-dropped",
      details: { pravoId: c.pravoId, source: c.source, reason, ...extra },
    });
  }

  // ── Находки ───────────────────────────────────────────────────────────────────────────────

  /** «Новые поступления» за все дни с последнего обработанного по вчерашний, но не больше 30 дней назад (LAW-12). */
  async function discoverArrivals(): Promise<number> {
    const today = d.clock.today();
    const yesterday = shiftDay(today, -1);
    const mark = await readMark(d.system, MARK_ARRIVALS);
    // Первый проход — только вчера: ретроспектива за годы — не по умолчанию (research §1.2, стратегия Е).
    let from = mark?.day == null ? yesterday : shiftDay(mark.day, 1);
    const oldest = shiftDay(today, -MAX_ARRIVAL_DAYS);
    if (from < oldest) from = oldest;
    let found = 0;
    for (let day = from; day <= yesterday; day = shiftDay(day, 1)) {
      const source = await d.source();
      const page = await source.fetchArrivals(LocalDate.parse(day));
      const parsed = parseArrivals(page.html);
      // Канарейка: число на странице должно совпасть с разобранным, иначе вёрстка изменилась — день не засчитывается.
      if (parsed.declared === null || parsed.declared !== parsed.entries.length) {
        d.log.warn({ code: "arrivals-layout" }, "law.arrivals.layout-changed");
        await d.notifications.notifyAdmins({
          kind: "law-layout-changed",
          key: `arrivals:${day}`,
          params: { pravoId: "novye-postupleniya" },
        });
        return found;
      }
      found += await addFoundCandidates(d.system, parsed.entries, "new-arrivals", day);
      await logUpdate(d.system, {
        at: d.clock.now(),
        actId: null,
        event: "arrivals-read",
        details: { day, count: parsed.entries.length },
      });
      await writeMark(d.system, MARK_ARRIVALS, { day });
    }
    return found;
  }

  /** Граф ссылок (LAW-11): ссылки из текстов загруженных актов, без перечня изменений в шапке; глубина — 1 шаг. */
  async function discoverLinks(): Promise<number> {
    let found = 0;
    for (const act of await actsToScanLinks(d.system)) {
      const { snapshotId, html } = await currentSnapshotHtml(d.system, act.id);
      const text = readActPage(html)
        .paragraphs.filter((p) => p.cls !== "changeadd")
        .map((p) => p.text)
        .join("\n");
      const ids = requisitesIn(text)
        .flatMap((r) => r.pravoIds)
        .filter((id) => id !== act.pravoId);
      const added = await addFoundCandidates(
        d.system,
        ids.map((pravoId) => ({ pravoId })),
        "link-graph",
        d.clock.today(),
      );
      await markLinksScanned(d.system, act.id, snapshotId);
      await logUpdate(d.system, {
        at: d.clock.now(),
        actId: act.id,
        event: "links-scanned",
        details: { references: ids.length, candidates: added },
      });
      found += added;
    }
    return found;
  }

  /** Ведомственные страницы раз в месяц: ссылки на pravo.by → кандидаты в очередь администратора (LAW-15). Текст оттуда не берётся. */
  async function discoverAgencies(): Promise<number> {
    const pages = await d.settings.get(AGENCY_PAGES);
    const now = d.clock.now();
    const mark = await readMark(d.system, MARK_AGENCIES);
    if (
      pages.length === 0 ||
      (mark?.at != null && now.getTime() - mark.at.getTime() < AGENCY_PERIOD_DAYS * DAY_MS)
    ) {
      return 0;
    }
    let found = 0;
    for (const url of pages) {
      try {
        const page = await d.agencies.fetchAgencyPage(url);
        const ids = pravoLinksIn(page.html, url);
        found += await addFoundCandidates(
          d.system,
          ids.map((pravoId) => ({ pravoId })),
          "agency",
          d.clock.today(),
        );
      } catch (error) {
        // Ведомственный сайт недоступен, закрыт robots или остановил цикл — не повод останавливать pravo.by.
        if (
          !(
            error instanceof LoaderStopped ||
            error instanceof SourceUnavailable ||
            error instanceof RobotsDenied
          )
        ) {
          throw error;
        }
        d.log.warn({ code: error.name }, "law.agency.page-failed");
      }
    }
    await writeMark(d.system, MARK_AGENCIES, { at: now });
    return found;
  }

  // ── Проверка кандидата ────────────────────────────────────────────────────────────────────

  /** Изменяющий акт (LAW-12): изменяемые акты — по реквизитам в заголовке, иначе в тексте самого акта; их проверка внеплановая. */
  async function handleAmending(
    c: CandidateRow,
    title: string,
    checked: Set<string>,
  ): Promise<void> {
    let targets = requisitesIn(title).flatMap((r) => r.pravoIds);
    if (targets.length === 0) {
      try {
        const page = await (await d.source()).fetchActText(c.pravoId);
        const text = readActPage(page.html)
          .paragraphs.filter((p) => p.cls !== "changeadd")
          .map((p) => p.text)
          .join("\n");
        targets = requisitesIn(text).flatMap((r) => r.pravoIds);
      } catch (error) {
        // Текста изменяющего акта на pravo.by часто нет: тогда изменяемые акты ждут ежедневной проверки карточек.
        if (
          !(
            error instanceof ActTextNotFound ||
            error instanceof SourceUnavailable ||
            error instanceof RobotsDenied
          )
        ) {
          throw error;
        }
      }
    }
    let rechecked = 0;
    for (const act of await actsByPravoIds(d.system, targets)) {
      if (checked.has(act.id)) continue;
      checked.add(act.id);
      rechecked += 1;
      try {
        await d.actCheck.checkCard(act);
        if (act.hasText && act.loadState === "loaded") await d.actCheck.checkText(act);
      } catch (error) {
        if (error instanceof LoaderStopped) throw error;
        d.log.warn({ code: "recheck-failed" }, "law.amending.recheck-failed");
      }
    }
    await decideCandidate(
      d.system,
      c.id,
      { status: "event", reason: "amending", title },
      d.clock.now(),
    );
    await logUpdate(d.system, {
      at: d.clock.now(),
      actId: null,
      event: "amending-act-seen",
      details: { pravoId: c.pravoId, targets: targets.length, rechecked },
    });
  }

  /** Тема акта для маршрута: у акта с текстом — по рубрикам ЕПК, у акта без текста — по заголовку, органу или модели. */
  async function topicFor(
    c: CandidateRow,
    title: string,
    kindLine: string,
    hasText: boolean,
  ): Promise<
    { topic: Topic | null; suggested: Topic | null; source: string | null } | "irrelevant"
  > {
    // Очередь администратора не нуждается в теме: решает человек, лишние запросы и вызовы модели не нужны.
    if (c.source === "agency" || c.source === "demand")
      return { topic: null, suggested: null, source: null };
    const source = await d.source();
    let epk: Topic | null = null;
    if (hasText) {
      const page = await source.fetchActRubrics(c.pravoId);
      epk =
        page === null
          ? null
          : topicOfRubrics(parseRubrics(page.html), await d.settings.get(EPK_TOPICS));
    }
    const hint = topicOfTitle(title) ?? topicOfOrgan(kindLine);
    if (epk !== null) return { topic: epk, suggested: epk, source: "epk" };
    if (hint !== null) {
      // Акт с текстом без рубрики остаётся «без темы» (LAW-14): орган и заголовок — лишь подсказка администратору.
      return {
        topic: hasText ? null : hint,
        suggested: hint,
        source: topicOfTitle(title) === null ? "organ" : "title",
      };
    }
    // Спорный случай: ни рубрики, ни органа, ни слов заголовка — единственное место, где зовётся модель (LAW-13).
    let modelTopic: Topic | null;
    try {
      modelTopic = await d.classify(title);
    } catch {
      d.log.warn({ code: "classify-failed" }, "law.growth.classify-failed");
      return { topic: null, suggested: null, source: null };
    }
    if (modelTopic === null) return "irrelevant";
    return { topic: hasText ? null : modelTopic, suggested: modelTopic, source: "model" };
  }

  /** Один кандидат: фильтры → карточка → текст → тема → маршрут. `later` — сайт не ответил, кандидат остаётся «найденным». */
  async function evaluateOne(c: CandidateRow, ctx: EvalContext): Promise<Verdict> {
    const patterns = await d.settings.get(FILTER_TITLE_PATTERNS);
    let title = c.title ?? "";
    let kindLine = c.kindLine ?? "";
    const pre = (): ReturnType<typeof prefilter> =>
      prefilter({ pravoId: c.pravoId, title, registryNo: c.registryNo }, patterns);
    const refuse = async (reason: string, extra: Record<string, string> = {}): Promise<Verdict> => {
      await drop(c, reason, extra);
      return "decided";
    };

    const first = pre();
    if (first?.reason === "local") return refuse("local");
    if (first !== null && c.title !== null) {
      if (first.reason === "amending" && c.source === "new-arrivals") {
        await handleAmending(c, title, ctx.checked);
        return "decided";
      }
      return refuse(first.reason, first.pattern === undefined ? {} : { pattern: first.pattern });
    }

    const source = await d.source();
    try {
      if (c.title === null) {
        const card = parseCard((await source.fetchActCard(c.pravoId)).html);
        title = card.title;
        kindLine = card.kindLine;
        if (title === "") return await refuse("card-unreadable");
        if (card.repealedOn !== null) return await refuse("repealed");
        const next = pre();
        if (next !== null) {
          return await refuse(
            next.reason,
            next.pattern === undefined ? {} : { pattern: next.pattern },
          );
        }
      }
      let hasText = true;
      try {
        await source.headActText(c.pravoId);
      } catch (error) {
        if (!(error instanceof ActTextNotFound)) throw error;
        hasText = false;
      }
      const found = await topicFor(c, title, kindLine, hasText);
      if (found === "irrelevant") return await refuse("model-irrelevant");
      const route = routeOf({
        source: c.source,
        hasText,
        topic: found.topic,
        autoAdd: (await d.settings.get(NEW_ACTS_MODE)) === "auto",
      });
      const patch = {
        title,
        kindLine,
        hasText,
        topic: found.suggested,
        topicSource: found.source,
      };
      if (route.target === "drop") return await refuse(route.reason ?? "no-topic");
      if (route.target === "queue") {
        await decideCandidate(
          d.system,
          c.id,
          { ...patch, status: "queued", reason: route.reason },
          d.clock.now(),
        );
        await logUpdate(d.system, {
          at: d.clock.now(),
          actId: null,
          event: "candidate-queued",
          details: { pravoId: c.pravoId, source: c.source, reason: route.reason ?? "" },
        });
        return "decided";
      }
      const kind = kindOfLine(kindLine);
      await addAct(d.system, {
        pravoId: c.pravoId,
        title,
        kind,
        isNpa: kind !== "plenum",
        hasText,
        source: c.source === "link-graph" ? "link-graph" : "new-arrivals",
        topic: found.topic,
        topicSource: found.topic === null ? null : found.source,
      });
      await decideCandidate(
        d.system,
        c.id,
        { ...patch, status: "added", reason: route.target },
        d.clock.now(),
      );
      await logUpdate(d.system, {
        at: d.clock.now(),
        actId: null,
        event: "act-added",
        details: { pravoId: c.pravoId, source: c.source, route: route.target },
      });
      ctx.added += 1;
      if (hasText) await loadNew(c.pravoId);
      return "decided";
    } catch (error) {
      if (error instanceof LoaderStopped) throw error;
      if (error instanceof ActTextNotFound) return await refuse("card-not-found");
      if (error instanceof RobotsDenied) return await refuse("robots-denied");
      if (error instanceof SourceUnavailable) return "later";
      throw error;
    }
  }

  /** Загрузка текста нового акта в тот же проход; ошибка — акт «с ошибкой», его подхватит ежедневная проверка. */
  async function loadNew(pravoId: string): Promise<void> {
    try {
      await d.loadAct(pravoId);
    } catch (error) {
      if (error instanceof LoaderStopped) throw error;
      const code = error instanceof SourceUnavailable ? "source-unavailable" : "load-failed";
      const act = (await actsByPravoIds(d.system, [pravoId]))[0];
      if (act !== undefined)
        await markActState(d.system, act.id, { loadState: "failed", lastProblem: code });
      d.log.warn({ code }, "law.growth.load-failed");
    }
  }

  interface EvalContext {
    added: number;
    readonly checked: Set<string>;
  }

  /** Проверить найденных кандидатов: отсев без запросов — без предела, с запросами — не больше `growth-batch` за проход. */
  async function evaluate(): Promise<{ added: number; decided: number }> {
    const ctx: EvalContext = { added: 0, checked: new Set() };
    const budget = await d.settings.get(GROWTH_BATCH);
    let decided = 0;
    let spent = 0;
    const patterns = await d.settings.get(FILTER_TITLE_PATTERNS);
    for (const c of await foundCandidates(d.system, budget * 20)) {
      // Отсев по ID и заголовку не требует сети и не тратит бюджет проверок; изменяющий акт и всё прочее — тратит.
      const pre = prefilter(
        { pravoId: c.pravoId, title: c.title ?? "", registryNo: c.registryNo },
        patterns,
      );
      if (pre === null || pre.reason === "amending") {
        if (spent >= budget) continue;
        spent += 1;
      }
      if ((await evaluateOne(c, ctx)) === "decided") decided += 1;
    }
    if (ctx.added > 0) {
      await d.notifications.notifyAdmins({
        kind: "law-new-acts",
        key: `new-acts:${d.clock.today()}`,
        params: { count: ctx.added },
      });
    }
    return { added: ctx.added, decided };
  }

  // ── Тексты новых актов без текста, журнал спроса ──────────────────────────────────────────

  /** Раз в неделю 8 недель: не появился ли текст у нового акта без текста (LAW-13 п. 4). */
  async function recheckText(): Promise<number> {
    const weeks = await d.settings.get(TEXT_CHECK_WEEKS);
    const now = d.clock.now();
    const source = await d.source();
    let appeared = 0;
    const due = await actsAwaitingText(d.system, {
      since: new Date(now.getTime() - weeks * 7 * DAY_MS),
      before: new Date(now.getTime() - 7 * DAY_MS),
    });
    for (const act of due) {
      try {
        await source.headActText(act.pravoId);
      } catch (error) {
        if (error instanceof ActTextNotFound) {
          await markTextChecked(d.system, act.id, now);
          continue;
        }
        if (error instanceof SourceUnavailable) continue;
        throw error;
      }
      await markTextChecked(d.system, act.id, now);
      const page = await source.fetchActRubrics(act.pravoId);
      const topic =
        page === null
          ? null
          : topicOfRubrics(parseRubrics(page.html), await d.settings.get(EPK_TOPICS));
      appeared += 1;
      await logUpdate(d.system, {
        at: now,
        actId: act.id,
        event: "text-appeared",
        details: { topic: topic ?? "" },
      });
      if (topic === null) {
        // Текст есть, а тема не определена: акт не индексируется сам (LAW-14) — решение за администратором.
        await requeueCandidate(d.system, act.pravoId, "text-appeared", now);
        continue;
      }
      await enableText(d.system, act.id, { topic, topicSource: "epk" });
      await loadNew(act.pravoId);
    }
    return appeared;
  }

  /** Недельная сводка спроса (LAW-15): темы без текстов вопросов, подходящие акты каталога — в очередь администратора. */
  async function summarizeDemand(): Promise<void> {
    const now = d.clock.now();
    const mark = await readMark(d.system, MARK_SUMMARY);
    if (mark?.at != null && now.getTime() - mark.at.getTime() < SUMMARY_PERIOD_DAYS * DAY_MS)
      return;
    const rows = await demandSince(
      d.system,
      new Date(now.getTime() - SUMMARY_PERIOD_DAYS * DAY_MS),
    );
    const topics = new Set(rows.map((r) => r.topic));
    const ids = [...new Set(rows.flatMap((r) => r.pravoIds))];
    let queued = 0;
    for (const act of await actsByPravoIds(d.system, ids)) {
      // В индексе акт уже отвечает на вопросы; предлагается то, что лежит карточкой или ждёт загрузки.
      if (act.loadState === "loaded") continue;
      if (
        await queueCandidate(
          d.system,
          {
            pravoId: act.pravoId,
            source: "demand",
            reason: "manual-decision",
            hasText: act.hasText,
          },
          now,
        )
      )
        queued += 1;
    }
    await logUpdate(d.system, {
      at: now,
      actId: null,
      event: "demand-summary",
      details: { questions: rows.length, topics: topics.size, queued },
    });
    await writeMark(d.system, MARK_SUMMARY, { at: now });
  }

  /** Фасад `legalBase.recordDemand`: тема и акты каталога, без текста вопроса (LAW-15, PRIV). */
  async function recordDemand(input: { topic: string; actIds: readonly string[] }): Promise<void> {
    if (
      !isTopic(input.topic) ||
      input.actIds.length > 20 ||
      !input.actIds.every((id) => PRAVO_ID.test(id))
    ) {
      throw new AppError("VALIDATION");
    }
    await addDemand(d.system, {
      at: d.clock.now(),
      topic: input.topic,
      pravoIds: [...new Set(input.actIds)],
    });
  }

  /**
   * Ночной проход. Остановка загрузчика (403/429, пустой контакт) — уведомление администратору и повторяемая ошибка; сбой
   * одной фазы (сайт не ответил) не отменяет остальные.
   */
  async function run(): Promise<void> {
    const phase = async (name: string, step: () => Promise<unknown>): Promise<void> => {
      try {
        await step();
      } catch (error) {
        if (error instanceof LoaderStopped) throw error;
        d.log.warn({ code: name }, "law.growth.phase-failed");
      }
    };
    try {
      await phase("arrivals", discoverArrivals);
      await phase("links", discoverLinks);
      await phase("agencies", discoverAgencies);
      await phase("evaluate", evaluate);
      await phase("text", recheckText);
      await phase("summary", summarizeDemand);
    } catch (error) {
      if (!(error instanceof LoaderStopped)) throw error;
      await d.notifications.notifyAdmins({
        kind: "law-update-failed",
        key: `loader-stopped:${error.reason}:${d.clock.today()}`,
        params: { reason: error.reason },
      });
      throw new AppError("UNAVAILABLE");
    }
    // Векторы новых актов — в этом же проходе; нет модели — «ждём модель», проход от этого не падает.
    await d.embedder.run();
  }

  return {
    run,
    discoverArrivals,
    discoverLinks,
    discoverAgencies,
    evaluate,
    recheckText,
    summarizeDemand,
    recordDemand,
  };
}

export type CatalogGrowth = ReturnType<typeof makeCatalogGrowth>;
