// Векторы фоном (LAW-22, LAW-23, LAW-10): задача `legal-base.embed` векторизует только действующие версии без вектора
// активной модели, порциями; у вектора — модель с именем и версией; смена активной модели превращает всё в «без
// вектора» и идёт той же задачей с прогрессом. Нет модели (сервис не запущен, самотест не прошёл) — задача не падает
// и не уходит в повторы, а ждёт: прогресс показывает «ждём модель», поиск идёт по реквизитам и FTS.
import type { Clock } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import {
  activeModel,
  pendingVersions,
  saveEmbeddings,
  vectorCounts,
} from "../infrastructure/db/embeddings.repo.ts";

/** Сколько фрагментов отправляем модели за раз. */
export const EMBED_BATCH = 32;
/** Длиннее текст модели не даём: фрагмент ≤ 3000 знаков, с путём — с запасом. */
const MAX_TEXT = 4000;

export interface EmbedDeps {
  readonly system: SystemDb;
  readonly embed: (texts: readonly string[]) => Promise<readonly number[][]>;
  readonly clock: Clock;
  readonly log: Logger;
}

export type VectorState = "idle" | "working" | "waiting-model";

export interface VectorProgress {
  readonly state: VectorState;
  readonly total: number;
  readonly embedded: number;
  readonly model: string | null;
}

export function makeEmbedder(d: EmbedDeps) {
  /** Векторизовать всё, что осталось; возвращает итог. Не бросает из-за недоступной модели. */
  async function run(ctx?: {
    signal?: AbortSignal;
    progress?: (percent: number) => Promise<void>;
  }): Promise<VectorProgress> {
    const model = await activeModel(d.system);
    if (model === undefined) return { state: "waiting-model", total: 0, embedded: 0, model: null };
    for (;;) {
      ctx?.signal?.throwIfAborted();
      const batch = await pendingVersions(d.system, model.id, EMBED_BATCH);
      if (batch.length === 0) break;
      let vectors: readonly number[][];
      try {
        vectors = await d.embed(batch.map((b) => b.text.slice(0, MAX_TEXT)));
      } catch {
        d.log.warn({}, "law.embed.waiting-model");
        const counts = await vectorCounts(d.system, model.id);
        return { state: "waiting-model", ...counts, model: model.name };
      }
      if (vectors.some((v) => v.length !== model.dimensions)) {
        d.log.warn({}, "law.embed.wrong-dimensions");
        const counts = await vectorCounts(d.system, model.id);
        return { state: "waiting-model", ...counts, model: model.name };
      }
      await saveEmbeddings(
        d.system,
        model.id,
        batch.map((b, i) => ({ versionId: b.id, vector: [...(vectors[i] ?? [])] })),
        d.clock.now(),
      );
      const counts = await vectorCounts(d.system, model.id);
      await ctx?.progress?.(
        counts.total === 0 ? 100 : Math.round((counts.embedded / counts.total) * 100),
      );
    }
    return { ...(await progressOf(model.id, model.name, "idle")) };
  }

  async function progressOf(
    modelId: string,
    name: string,
    state: VectorState,
  ): Promise<VectorProgress> {
    return { state, ...(await vectorCounts(d.system, modelId)), model: name };
  }

  /** Прогресс для админки (T-039): «векторный индекс: 43 %» или «ждём модель». */
  async function progress(modelReady: boolean): Promise<VectorProgress> {
    const model = await activeModel(d.system);
    if (model === undefined) return { state: "waiting-model", total: 0, embedded: 0, model: null };
    const counts = await vectorCounts(d.system, model.id);
    const state: VectorState =
      counts.embedded >= counts.total ? "idle" : modelReady ? "working" : "waiting-model";
    return { state, ...counts, model: model.name };
  }

  return { run, progress };
}

export type Embedder = ReturnType<typeof makeEmbedder>;
