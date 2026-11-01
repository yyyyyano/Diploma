// Дословные цитаты норм под расчётом вычета (TAX-06, P3): пункт ст. 209–211 НК находится точным обращением, а текст в ответ
// подставляет legal-consult по метке версии фрагмента — тот же путь, что у правового ответа агента. Модель текст закона не пишет.
import type { DeductionKind, DeductionResult } from "@kosht/contract";
import type { LegalBaseFacade } from "../../legal-base/index.ts";
import type { LegalConsultFacade } from "../../legal-consult/index.ts";

/** Пункт нормы, в котором названа сумма вычета: обучение — п. 1.1 ст. 210, жильё — п. 1.1 ст. 211, дети — п. 1.2 ст. 209. */
export const NORM_REFS: Readonly<Record<DeductionKind, string>> = {
  education: "п. 1.1 ст. 210 НК",
  housing: "п. 1.1 ст. 211 НК",
  children: "п. 1.2 ст. 209 НК",
};

const NK = "Hk0900071";

export interface CitationDeps {
  readonly legalBase: Pick<LegalBaseFacade, "search">;
  readonly legalConsult: Pick<LegalConsultFacade, "finalizeAnswer">;
}

/** Цитата пункта нормы; нормы нет в базе — пусто (расчёт от этого не зависит, цитата — основание). */
export function makeNormCitations(d: CitationDeps) {
  return async function citations(kind: DeductionKind): Promise<DeductionResult["citations"]> {
    const found = await d.legalBase.search(NORM_REFS[kind], { limit: 1 });
    const head = found.mode === "exact" ? found.fragments.find((f) => f.pravoId === NK) : undefined;
    if (head === undefined) return [];
    const answer = await d.legalConsult.finalizeAnswer({
      draft: `[[F${head.versionId}]]`,
      topic: "taxes",
      candidateActIds: [],
    });
    return answer.citations.flatMap((citation) =>
      citation.kind === "quote" ? [{ ...citation, notes: [...citation.notes] }] : [],
    );
  };
}
