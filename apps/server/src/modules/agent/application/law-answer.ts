// Правовой ответ (LEGAL-02…08, LAW-15, P3): черновик модели с метками `[[F…]]` и цитатами проходит `legal-consult.finalizeAnswer`
// целиком — программа подставляет дословные цитаты, дату редакции, ссылку на pravo.by, пометку «Не является юридической
// консультацией». Если норм в базе нет («в моей базе нет»), тему вопроса определяет малая модель, чтобы ответ попал в
// журнал спроса (LAW-15): в журнал идёт тема и акты, текста вопроса нет.
import { LawAnswerData } from "@kosht/contract";
import type { Scope } from "@kosht/kernel";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { LlmFacade } from "../../llm/index.ts";
import { TOPICS, type LegalConsultFacade, type Topic } from "../../legal-consult/index.ts";

export const TOPIC_PROMPT_VERSION = "agent-law-topic-v1";
const TOPIC_INSTRUCTIONS =
  "Classify a citizen's question about Belarusian law by topic. Answer with exactly one topic id: taxes; consumer (purchases and consumer rights); housing; banking (banks, loans, deposits, cards); work (employment, salary); benefits (state benefits, pensions, privileges, family capital); contracts (contracts, insurance, transport); education-health (paid education and medicine); family (alimony, inheritance); fines (administrative fines). Answer none if the question is not about money or property rights of citizens. Use only the text.";

export interface LawDeps {
  readonly legalConsult: Pick<LegalConsultFacade, "finalizeAnswer">;
  readonly llm: Pick<LlmFacade, "classify">;
  readonly log: Logger;
}

export async function lawAnswer(
  d: LawDeps,
  scope: Scope,
  input: {
    readonly draft: string;
    /** Вопрос пользователя: только для определения темы, дальше не идёт. */
    readonly question: string;
    /** Акты, которые назвал поиск по законам в этом запуске. */
    readonly candidateActIds: readonly string[];
  },
): Promise<LawAnswerData> {
  const base = { draft: input.draft, candidateActIds: input.candidateActIds };
  let answer = await d.legalConsult.finalizeAnswer({ ...base, topic: null });
  if (answer.outcome === "no-base") {
    const topic = await topicOf(d, scope, input.question);
    if (topic !== null) answer = await d.legalConsult.finalizeAnswer({ ...base, topic });
  }
  return LawAnswerData.parse(answer);
}

/** Тема вопроса; сбой модели — без темы (ответ «в моей базе нет» от этого не меняется, пропадает только запись спроса). */
async function topicOf(d: LawDeps, scope: Scope, question: string): Promise<Topic | null> {
  try {
    const label = await d.llm.classify(scope, {
      task: "law.topic",
      labels: ["none", ...TOPICS],
      instructions: TOPIC_INSTRUCTIONS,
      text: question,
      promptVersion: TOPIC_PROMPT_VERSION,
    });
    return label === "none" ? null : label;
  } catch (error) {
    d.log.warn({ err: error, code: "TOPIC_UNAVAILABLE" }, "agent.topic-unavailable");
    return null;
  }
}
