// Поток ответа агента (AGT-04, AGT-01, LEGAL-03, CHAT-04, LLM-10): преобразование кусков UI-сообщения между моделью и
// сайтом. Обычный ответ идёт по предложениям: предложение держится до точки, числа в нём сверяются с результатами
// инструментов (P1), непроверенное не выводится, в конце — пометка. Правовой ответ (набор `legal`, был поиск по
// законам) по ходу показывает только шаги, а текст приходит целиком после `finalizeAnswer` отдельной частью
// `data-law-answer`. Вызов `make_chart` порождает часть `data-chart`; предел шагов и сбой цепочки моделей — честная
// пометка; в метаданных куска `finish` — кто ответил (LLM-10).
import { ChartData, type AnswerMetadata, type LawAnswerData } from "@kosht/contract";
import type { AgentT } from "@kosht/i18n";
import type { UIMessageChunk } from "ai";
import type { Logger } from "../../../platform/logging/logger.ts";
import { createSentenceSplitter, type NumberLedger } from "../../llm/index.ts";
import { MAKE_CHART } from "./make-chart.ts";

/** Что набирается за запуск и нужно потоку к концу ответа. */
export interface RunState {
  /** Был вызван инструмент права: ответ — правовой, текст пойдёт через finalizeAnswer. */
  legalToolUsed: boolean;
  /** Акты, названные поиском по законам (для «в моей базе нет» и журнала спроса). */
  readonly candidateActIds: Set<string>;
  /** Кто ответил (providerMetadata.kosht последнего шага). */
  answeredBy: AnswerMetadata["answeredBy"] | undefined;
  /** Дошли до последнего шага без инструментов (AGT-01). */
  stepLimitHit: boolean;
}

export function newRunState(): RunState {
  return {
    legalToolUsed: false,
    candidateActIds: new Set(),
    answeredBy: undefined,
    stepLimitHit: false,
  };
}

export interface AnswerStreamDeps {
  readonly ledger: NumberLedger;
  readonly state: RunState;
  readonly t: AgentT;
  readonly log: Logger;
  /** Набор `legal`: текст копится и идёт целиком через finalizeAnswer, когда ответ правовой. */
  readonly legalMode: boolean;
  readonly finalizeLaw: (draft: string) => Promise<LawAnswerData>;
}

/** Предложения текста без тех, где есть непроверенное число; `dropped` — сколько убрано. */
function verifyPieces(
  text: string,
  ledger: NumberLedger,
): { readonly text: string; readonly dropped: number } {
  const splitter = createSentenceSplitter();
  const sentences = splitter.push(text);
  const rest = splitter.flush();
  if (rest !== undefined) sentences.push(rest);
  let dropped = 0;
  const kept = sentences.filter((sentence) => {
    if (ledger.unverified(sentence).length === 0) return true;
    dropped += 1;
    return false;
  });
  return { text: kept.join(""), dropped };
}

export function answerTransform(
  d: AnswerStreamDeps,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  const texts = new Map<
    string,
    { started: boolean; splitter: ReturnType<typeof createSentenceSplitter> }
  >();
  const toolNames = new Map<string, string>();
  const chartInputs = new Map<string, unknown>();
  let notes = 0;
  const noteId = () => `note-${String((notes += 1))}`;
  let legalDraft = "";
  let dropped = 0;
  let failed = false;
  let ended = false;

  const enqueueText = (
    controller: TransformStreamDefaultController<UIMessageChunk>,
    id: string,
    text: string,
  ) => {
    controller.enqueue({ type: "text-start", id });
    controller.enqueue({ type: "text-delta", id, delta: text });
    controller.enqueue({ type: "text-end", id });
  };

  /** Предложение в поток, если числа проверены; иначе — только счётчик (в лог — число, не текст). */
  function emit(
    controller: TransformStreamDefaultController<UIMessageChunk>,
    id: string,
    piece: string,
  ): void {
    const part = texts.get(id);
    if (part === undefined) return;
    if (d.ledger.unverified(piece).length > 0) {
      dropped += 1;
      d.log.warn({ count: d.ledger.unverified(piece).length }, "agent.number-unverified");
      return;
    }
    if (!part.started) {
      if (piece.trim() === "") return;
      part.started = true;
      controller.enqueue({ type: "text-start", id });
    }
    controller.enqueue({ type: "text-delta", id, delta: piece });
  }

  async function finish(
    controller: TransformStreamDefaultController<UIMessageChunk>,
    chunk: Extract<UIMessageChunk, { type: "finish" }>,
  ): Promise<void> {
    if (d.legalMode && legalDraft.trim() !== "") {
      const isLaw = d.state.legalToolUsed || legalDraft.includes("[[");
      if (isLaw) {
        // Числа черновика сверяются до подстановки цитат: текст закона в результатах поиска, а своих чисел модель не пишет.
        const verified = verifyPieces(legalDraft, d.ledger);
        if (verified.dropped > 0) {
          dropped += verified.dropped;
          d.log.warn({ count: verified.dropped }, "agent.number-unverified");
        }
        try {
          const answer = await d.finalizeLaw(verified.text.trim());
          controller.enqueue({ type: "data-law-answer", data: answer });
        } catch (error) {
          d.log.error({ err: error, code: "LAW_ANSWER_FAILED" }, "agent.law-answer-failed");
          failed = true;
        }
      } else {
        const verified = verifyPieces(legalDraft, d.ledger);
        dropped += verified.dropped;
        if (verified.dropped > 0)
          d.log.warn({ count: verified.dropped }, "agent.number-unverified");
        if (verified.text.trim() !== "") enqueueText(controller, noteId(), verified.text.trim());
      }
    }
    if (failed) enqueueText(controller, noteId(), d.t("modelUnavailable"));
    if (dropped > 0) enqueueText(controller, noteId(), d.t("unverified"));
    if (d.state.stepLimitHit) enqueueText(controller, noteId(), d.t("stepLimit"));
    controller.enqueue(
      d.state.answeredBy === undefined
        ? chunk
        : {
            ...chunk,
            messageMetadata: { answeredBy: d.state.answeredBy } satisfies AnswerMetadata,
          },
    );
  }

  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    flush(controller) {
      // Сбой модели обрывает поток без куска finish: сообщение всё равно завершается честной пометкой.
      if (ended || !failed) return;
      enqueueText(controller, noteId(), d.t("modelUnavailable"));
      controller.enqueue({ type: "finish", finishReason: "error" });
    },
    async transform(chunk, controller) {
      switch (chunk.type) {
        case "text-start":
          if (!d.legalMode)
            texts.set(chunk.id, { started: false, splitter: createSentenceSplitter() });
          return;
        case "text-delta": {
          if (d.legalMode) {
            legalDraft += chunk.delta;
            return;
          }
          const part = texts.get(chunk.id);
          if (part === undefined) return;
          for (const sentence of part.splitter.push(chunk.delta))
            emit(controller, chunk.id, sentence);
          return;
        }
        case "text-end": {
          if (d.legalMode) {
            legalDraft += "\n\n";
            return;
          }
          const part = texts.get(chunk.id);
          if (part === undefined) return;
          const rest = part.splitter.flush();
          if (rest !== undefined) emit(controller, chunk.id, rest);
          if (part.started) controller.enqueue(chunk);
          texts.delete(chunk.id);
          return;
        }
        case "reasoning-start":
        case "reasoning-delta":
        case "reasoning-end":
          return;
        case "tool-input-start":
          toolNames.set(chunk.toolCallId, chunk.toolName);
          controller.enqueue(chunk);
          return;
        case "tool-input-available":
          toolNames.set(chunk.toolCallId, chunk.toolName);
          if (chunk.toolName === MAKE_CHART) chartInputs.set(chunk.toolCallId, chunk.input);
          controller.enqueue(chunk);
          return;
        case "tool-output-available": {
          controller.enqueue(chunk);
          if (toolNames.get(chunk.toolCallId) === MAKE_CHART) {
            const ok = (chunk.output as { ok?: unknown } | undefined)?.ok === true;
            const chart = ChartData.safeParse(chartInputs.get(chunk.toolCallId));
            if (ok && chart.success) controller.enqueue({ type: "data-chart", data: chart.data });
          }
          return;
        }
        case "error":
          // Текст ошибки не уходит наружу (OBS-04): сайт получит честную пометку в конце ответа.
          failed = true;
          d.log.error({ code: "MODEL_STREAM_FAILED" }, "agent.model-failed");
          return;
        case "abort":
          ended = true;
          controller.enqueue(chunk);
          return;
        case "finish":
          ended = true;
          await finish(controller, chunk);
          return;
        default:
          controller.enqueue(chunk);
      }
    },
  });
}
