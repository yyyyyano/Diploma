// Постобработка правового ответа агента (LEGAL-02…08, CHAT-05/06/10, LAW-15, P3): метки `[[F…]]` → дословные цитаты версий фрагментов
// с датой редакции, ссылкой на pravo.by и предупреждением о принятых изменениях; вольные цитаты проверяются на дословность;
// нет нормы в базе — «в моей базе нет» с актом из каталога и запись темы в журнал спроса; вопрос о прошлой дате — ставка из
// таблицы и честное «прежнюю редакцию процитировать не могу». Тексты — из словаря `legal`, числа — из таблицы ставок.
import { formatDate, formatMoney, formatScaled, type LegalT } from "@kosht/i18n";
import { LocalDate, Money } from "@kosht/kernel";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { LegalBaseFacade, Topic } from "../../legal-base/index.ts";
import type { NormTablesFacade } from "../../norm-tables/index.ts";
import { scanDraft } from "../domain/draft.ts";
import {
  labelParts,
  resolveAnswer,
  type Citation,
  type LinkReason,
  type PendingChange,
  type SourceAct,
  type SourceVersion,
} from "../domain/resolve-answer.ts";

export type LawPart =
  | { readonly type: "text"; readonly text: string }
  /** Ссылка на блок `citations[n - 1]` в этом месте: «ст. 209 п. 1.1 НК» раскрывает цитату (CHAT-05). */
  | { readonly type: "cite"; readonly n: number };

export type LawCitation =
  | {
      readonly n: number;
      readonly kind: "quote";
      readonly versionId: string;
      readonly pravoId: string;
      readonly actTitle: string;
      /** «ст. 209, п. 1.1»; null — акт без статей. */
      readonly label: string | null;
      /** Путь целиком: «НК (Особенная часть) › Глава 16 › Статья 209 › п. 1». */
      readonly path: string;
      /** Дословный текст версии фрагмента (DES-12: блок цитаты закона). */
      readonly text: string;
      /** «в редакции на 21.10.2026». */
      readonly edition: string;
      readonly editionOn: string | null;
      readonly url: string;
      /** Версия заменена новой редакцией (CHAT-10): показан прежний текст. */
      readonly changedSince: boolean;
      /** Предупреждения: текст изменился, приняты изменения, ещё не вошедшие в текст. */
      readonly notes: readonly string[];
    }
  | {
      readonly n: number;
      readonly kind: "link";
      readonly reason: LinkReason;
      readonly pravoId: string;
      readonly actTitle: string;
      readonly label: string | null;
      readonly url: string;
      /** Пометка: почему вместо цитаты ссылка. */
      readonly note: string;
    };

export interface LawNotice {
  readonly kind: "past-date" | "rate" | "unresolved" | "disclaimer";
  readonly text: string;
}

/** Итог: ответ с подставленными цитатами и пометками под ним. */
export interface LawAnswer {
  /** `no-base` — норм по вопросу в базе нет: текст черновика заменён ответом «в моей базе нет» (LEGAL-04). */
  readonly outcome: "cited" | "no-base";
  readonly parts: readonly LawPart[];
  readonly citations: readonly LawCitation[];
  readonly notices: readonly LawNotice[];
  /** Версии, на которые ссылается ответ: chat запоминает их у сообщения и позже помечает «статья изменилась» (CHAT-10). */
  readonly versionIds: readonly string[];
}

export interface FinalizeInput {
  /** Черновик ответа модели с метками `[[F<id версии>]]`, `[[A<id акта>]]` и цитатами «…» [[F…]]. */
  readonly draft: string;
  /** Тема вопроса для журнала спроса (LAW-15): пишется только при «в моей базе нет»; текст вопроса не передаётся. */
  readonly topic: Topic | null;
  /** Акты каталога (ID pravo.by), которые поиск назвал по вопросу: в «в моей базе нет» их называют, в журнал спроса идут они. */
  readonly candidateActIds: readonly string[];
  /** Вопрос о прошлой дате (LEGAL-08): день и параметр таблицы ставок; акт — по умолчанию первый из цитат или кандидатов. */
  readonly asOf?: { readonly day: string; readonly param?: string; readonly pravoId?: string };
}

export interface FinalizeDeps {
  readonly legalBase: Pick<
    LegalBaseFacade,
    "citations" | "actCard" | "pendingChanges" | "recordDemand" | "firstEditionOn"
  >;
  readonly rate: NormTablesFacade["rate"];
  readonly t: LegalT;
  readonly minFreeWords: () => Promise<number>;
  readonly log: Logger;
}

const MAX_NAMED_ACTS = 3;
const PRAVO_ID = /^[A-Za-z][A-Za-z0-9]{5,11}$/u;
const actUrl = (pravoId: string, hasText: boolean) =>
  `https://pravo.by/document/?guid=${hasText ? "3871" : "3961"}&p0=${pravoId}`;

export function makeFinalizeAnswer(d: FinalizeDeps) {
  const { t } = d;
  const day = (iso: string) => formatDate(LocalDate.parse(iso));

  /** «ст. 209, п. 1.1, пп. 2, ч. 2» по ключу пути; у акта без статей — null. */
  function labelOf(pathKey: string | null): string | null {
    if (pathKey === null) return null;
    const p = labelParts(pathKey);
    const pieces: string[] = [];
    if (p.article !== null) pieces.push(t("label.article", { n: p.article }));
    if (p.point !== null) pieces.push(t("label.point", { n: p.point }));
    if (p.subpoint !== null) pieces.push(t("label.subpoint", { n: p.subpoint }));
    if (p.part !== null) pieces.push(t("label.part", { n: p.part }));
    return pieces.length === 0 ? null : pieces.join(", ");
  }

  const pendingNote = (c: PendingChange): string =>
    c.inForceOn === null
      ? t("quote.pending", { description: c.description })
      : t("quote.pendingFrom", { description: c.description, date: day(c.inForceOn) });

  const linkNote = (reason: LinkReason, repealedOn: string | null): string => {
    switch (reason) {
      case "no-text":
        return t("link.noText");
      case "quote-unverified":
        return t("link.quoteUnverified");
      case "excluded":
        return t("link.excluded");
      case "repealed":
        return repealedOn === null
          ? t("link.repealed")
          : t("link.repealedSince", { date: day(repealedOn) });
      case "named":
        return t("link.named");
    }
  };

  function present(c: Citation): LawCitation {
    if (c.kind === "link") {
      return {
        n: c.n,
        kind: "link",
        reason: c.reason,
        pravoId: c.pravoId,
        actTitle: c.actTitle,
        label: labelOf(c.pathKey),
        url: c.url,
        note: linkNote(c.reason, c.repealedOn),
      };
    }
    return {
      n: c.n,
      kind: "quote",
      versionId: c.versionId,
      pravoId: c.pravoId,
      actTitle: c.actTitle,
      label: labelOf(c.pathKey),
      path: c.path,
      text: c.text,
      edition:
        c.editionOn === null
          ? t("quote.editionUnknown")
          : t("quote.edition", { date: day(c.editionOn) }),
      editionOn: c.editionOn,
      url: c.url,
      changedSince: c.changedSince,
      notes: [...(c.changedSince ? [t("quote.changedSince")] : []), ...c.warnings.map(pendingNote)],
    };
  }

  /** LEGAL-08: день раньше первой редакции в базе — ставка из таблицы и «прежнюю редакцию процитировать не могу». */
  async function pastDateNotices(
    asOf: NonNullable<FinalizeInput["asOf"]>,
    pravoId: string | undefined,
    title: string | undefined,
  ): Promise<LawNotice[]> {
    if (pravoId === undefined) return [];
    const first = await d.legalBase.firstEditionOn(pravoId);
    if (first === null || asOf.day >= first) return [];
    const actTitle = title ?? (await d.legalBase.actCard(pravoId))?.title ?? pravoId;
    const notices: LawNotice[] = [
      { kind: "past-date", text: t("pastDate.lead", { title: actTitle, edition: day(first) }) },
    ];
    if (asOf.param === undefined) return notices;
    const rate = await d.rate(asOf.param, asOf.day);
    if (!rate.found) {
      const key =
        rate.reason === "unconfirmed" ? "pastDate.rateUnconfirmed" : "pastDate.rateMissing";
      return [...notices, { kind: "rate", text: t(key, { day: day(asOf.day) }) }];
    }
    const value =
      rate.unit === "byn-minor"
        ? formatMoney(Money.of(rate.value, "BYN"))
        : t("pastDate.percent", { value: formatScaled(rate.value, 2) });
    const sourceTitle =
      rate.source.act === null
        ? null
        : ((await d.legalBase.actCard(rate.source.act))?.title ?? rate.source.act);
    const sourceParts: string[] = [];
    if (sourceTitle !== null) sourceParts.push(sourceTitle);
    if (rate.source.article !== null) {
      sourceParts.push(t("label.article", { n: rate.source.article }));
    }
    if (rate.source.point !== null) sourceParts.push(t("label.point", { n: rate.source.point }));
    const confirmed = t(
      rate.confirmedBy === "developer" ? "pastDate.confirmedDeveloper" : "pastDate.confirmedAdmin",
      { date: day(rate.confirmedOn) },
    );
    return [
      ...notices,
      {
        kind: "rate",
        text: t("pastDate.rate", {
          day: day(asOf.day),
          value,
          source: sourceParts.length === 0 ? t("pastDate.sourceUnknown") : sourceParts.join(", "),
          confirmed,
        }),
      },
    ];
  }

  /** LEGAL-04: норм по вопросу нет — не выдумываем; называем акты из каталога, пишем тему в журнал спроса (LAW-15). */
  async function noBase(input: FinalizeInput) {
    const parts: LawPart[] = [{ type: "text", text: t("noBase.lead") }];
    const citations: LawCitation[] = [];
    const named: string[] = [];
    for (const id of new Set(input.candidateActIds)) {
      if (!PRAVO_ID.test(id) || citations.length >= MAX_NAMED_ACTS) continue;
      const card = await d.legalBase.actCard(id);
      if (card === undefined || card.status === "excluded") continue;
      const reason: LinkReason =
        card.status === "repealed" ? "repealed" : card.hasText ? "named" : "no-text";
      const n = citations.length + 1;
      citations.push({
        n,
        kind: "link",
        reason,
        pravoId: card.pravoId,
        actTitle: card.title,
        label: null,
        url: actUrl(card.pravoId, card.hasText),
        note: linkNote(reason, card.repealedOn),
      });
      const key =
        reason === "repealed"
          ? "noBase.actRepealed"
          : reason === "named"
            ? "noBase.act"
            : "noBase.actNoText";
      parts.push(
        { type: "text", text: `\n\n${t(key, { title: card.title })} ` },
        { type: "cite", n },
      );
      named.push(card.pravoId);
    }
    if (input.topic !== null) {
      try {
        await d.legalBase.recordDemand({ topic: input.topic, actIds: named });
      } catch {
        // Журнал спроса — побочное дело: ответ пользователю не должен падать из-за него. Тему и акты в лог не пишем (PRIV).
        d.log.warn({ code: "demand-not-recorded" }, "law.demand-failed");
      }
    }
    return { parts, citations };
  }

  return async function finalizeAnswer(input: FinalizeInput): Promise<LawAnswer> {
    const items = scanDraft(input.draft);
    const fragmentIds = items.flatMap((i) =>
      i.type === "mark" && i.kind === "fragment" ? [i.id] : [],
    );
    const actIds = items.flatMap((i) => (i.type === "mark" && i.kind === "act" ? [i.id] : []));
    const versions: SourceVersion[] = [...(await d.legalBase.citations(fragmentIds))];
    const acts: SourceAct[] = [];
    for (const id of new Set(actIds)) {
      const card = await d.legalBase.actCard(id);
      if (card === undefined) continue;
      acts.push({
        pravoId: card.pravoId,
        title: card.title,
        hasText: card.hasText,
        status: card.status === "repealed" || card.status === "excluded" ? card.status : "active",
        repealedOn: card.repealedOn,
        url: actUrl(card.pravoId, card.hasText),
      });
    }
    const pending = new Map<string, readonly PendingChange[]>();
    for (const pravoId of new Set(versions.map((v) => v.pravoId))) {
      pending.set(
        pravoId,
        (await d.legalBase.pendingChanges(pravoId)).map((c) => ({
          description: c.description,
          inForceOn: c.inForceOn,
          articles: c.articles,
        })),
      );
    }
    const resolved = resolveAnswer({
      items,
      versions: new Map(versions.map((v) => [v.versionId, v])),
      acts: new Map(acts.map((a) => [a.pravoId, a])),
      pending,
      minFreeWords: await d.minFreeWords(),
    });

    const body = resolved.grounded
      ? {
          parts: resolved.parts.map((p): LawPart =>
            p.type === "removed" ? { type: "text", text: t("removedQuote") } : p,
          ),
          citations: resolved.citations.map(present),
        }
      : await noBase(input);

    const first = resolved.citations[0];
    const notices: LawNotice[] =
      input.asOf === undefined
        ? []
        : await pastDateNotices(
            input.asOf,
            input.asOf.pravoId ??
              first?.pravoId ??
              input.candidateActIds.find((id) => PRAVO_ID.test(id)),
            input.asOf.pravoId === undefined ? first?.actTitle : undefined,
          );
    if (resolved.unresolved > 0) {
      notices.push({ kind: "unresolved", text: t("unresolved", { count: resolved.unresolved }) });
    }
    notices.push({ kind: "disclaimer", text: t("disclaimer") });

    return {
      outcome: resolved.grounded ? "cited" : "no-base",
      parts: body.parts,
      citations: body.citations,
      notices,
      versionIds: body.citations.flatMap((c) => (c.kind === "quote" ? [c.versionId] : [])),
    };
  };
}

export type FinalizeAnswer = ReturnType<typeof makeFinalizeAnswer>;
