// Модуль legal-consult (паспорт — CLAUDE.md): правовой консультант — подстановка дословных цитат по меткам `[[F…]]`, «в моей
// базе нет», вопрос о прошлой дате (T-041, LEGAL-02…08, P3). Ответ строит агент (T-042) по найденным фрагментам, а `finalizeAnswer`
// проверяет и оформляет его: модель не пишет текст закона — только метки.
import { createLegalT } from "@kosht/i18n";
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { LegalBaseFacade } from "../legal-base/index.ts";
import type { NormTablesFacade } from "../norm-tables/index.ts";
import { legalConsultTools } from "./agent/tools.ts";
import { legalConsultRouter } from "./api/router.ts";
import { makeChecklists } from "./application/checklists.ts";
import { makeFinalizeAnswer } from "./application/finalize-answer.ts";
import { FREE_QUOTE_MIN_WORDS, LEGAL_CONSULT_SETTINGS } from "./settings.ts";
import { legalConsultUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface LegalConsultFacades {
  readonly legalBase: LegalBaseFacade;
  readonly normTables: NormTablesFacade;
}

export function createLegalConsultModule({
  platform,
  facades,
}: ModuleDeps<LegalConsultFacades, Platform>) {
  const t = createLegalT();
  const checklists = makeChecklists({ t });
  const finalizeAnswer = makeFinalizeAnswer({
    legalBase: facades.legalBase,
    rate: facades.normTables.rate,
    t,
    minFreeWords: () => platform.settings.get(FREE_QUOTE_MIN_WORDS),
    log: platform.log,
  });
  return defineModule({
    id: "legal-consult",
    facade: {
      /**
       * Постобработка правового ответа (LEGAL-03…08): метки → дословные цитаты с датой редакции и ссылкой, проверка вольных цитат,
       * «в моей базе нет» с записью темы в журнал спроса, ставка вместо цитаты прежней редакции. Данных пользователя не берёт.
       */
      finalizeAnswer,
    },
    router: legalConsultRouter(checklists),
    tools: Object.values(legalConsultTools(checklists)),
    userData: legalConsultUserData,
    settings: LEGAL_CONSULT_SETTINGS,
  });
}

/** Что модуль даёт соседям: постобработка правового ответа (агент, T-042). */
export type LegalConsultFacade = ReturnType<typeof createLegalConsultModule>["facade"];
