// Демо-пользователь: «создать, если нет» и «пересоздать» (DEMO-03, DEMO-04). Пользователя и его scope отдаёт identity; данные
// пишет `generate` — под scope демо, поэтому реальных пользователей это не затрагивает (изоляция). Готовность — не отдельная
// отметка, а итог: итоги недели (последний шаг записи) уже есть. Пересоздание — `privacy.purge` под scope демо (весь набор по
// реестру владельцев, как «Удалить мои данные»), затем согласие на облако заново (PRIV-02: у демо оно выдано по умолчанию) и запись.
// Один процесс не пишет историю дважды: вызовы идут по очереди. Два процесса (api и worker после первого запуска) расходятся на
// первой же карте: уникальна — проигравший ждёт готовности, а не пишет рядом; не дождался (упавший на полпути) — чистит и пишет сам.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { IdentityFacade } from "../../identity/index.ts";
import type { PrivacyFacade } from "../../privacy/index.ts";
import type { WeeklyFacade } from "../../weekly/index.ts";
import { STORY_ACCOUNTS } from "../domain/story.ts";
import type { Generate, GenerateReport } from "./generate.ts";

/** Сколько раз и как часто проигравший спрашивает «готово ли» (≈ 60 с), прежде чем решить, что победитель упал. */
export const WAIT_POLLS = 120;
export const WAIT_MS = 500;

export interface DemoDeps {
  readonly platform: Pick<Platform, "log" | "jobs" | "scoped">;
  readonly identity: Pick<IdentityFacade, "ensureDemoUser">;
  readonly privacy: Pick<PrivacyFacade, "purge" | "recordRegistrationConsents">;
  readonly weekly: Pick<WeeklyFacade, "history">;
  readonly accounts: Pick<AccountsFacade, "findCard">;
  readonly generate: Generate;
  /** Пауза между опросами готовности (тесты подставляют мгновенную). */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly waitPolls?: number;
}

export function makeDemo(d: DemoDeps) {
  const { log } = d.platform;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const polls = d.waitPolls ?? WAIT_POLLS;
  // Вызовы одного процесса — по очереди.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const complete = async (s: ScopedDb) => (await d.weekly.history(s, 1)).length > 0;
  const first = STORY_ACCOUNTS[0];
  /** Запись истории уже начата (кем-то): первая карта существует. */
  const started = async (s: ScopedDb) =>
    first !== undefined &&
    (await d.accounts.findCard(s, {
      bank: first.bank,
      mask: first.mask,
      currency: first.currency,
    })) !== undefined;

  /** Очистить данные демо до пустого пользователя: задачи домохозяйства, все таблицы владельцев, согласия заново. */
  async function reset(s: ScopedDb): Promise<void> {
    await d.platform.jobs.discardHousehold(s.scope.householdId);
    await d.privacy.purge(s);
    await s.transaction((tx) =>
      d.privacy.recordRegistrationConsents(tx, {
        personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
        cloud: { accepted: true, version: CONSENT_VERSIONS.cloud },
      }),
    );
  }

  async function waitComplete(s: ScopedDb): Promise<boolean> {
    for (let attempt = 0; attempt < polls; attempt++) {
      if (await complete(s)) return true;
      await sleep(WAIT_MS);
    }
    return complete(s);
  }

  /** Демо есть и готово: создать пользователя и записать историю, если их нет (DEMO-04). */
  function ensure(): Promise<{ readonly report: GenerateReport | undefined }> {
    return serial(async () => {
      const { scope } = await d.identity.ensureDemoUser();
      const s = d.platform.scoped(scope);
      if (await complete(s)) return { report: undefined };
      if (await started(s)) {
        // Кто-то уже пишет (другой процесс): ждём готовности; не дождались — он упал, начинаем заново.
        if (await waitComplete(s)) return { report: undefined };
        log.warn({ userId: scope.userId }, "demo.stale-restart");
        await reset(s);
        return { report: await d.generate(s) };
      }
      try {
        return { report: await d.generate(s) };
      } catch (error) {
        // Первая карта уникальна: проиграли гонку другому процессу — ждём его, а не пишем рядом (CONFLICT из accounts.create).
        if (!(error instanceof AppError && error.code === "CONFLICT")) throw error;
        if (await waitComplete(s)) return { report: undefined };
        throw error;
      }
    });
  }

  /** «Пересоздать демо-данные» (DEMO-03): очистить и записать заново на сегодняшний день. */
  function recreate(): Promise<GenerateReport> {
    return serial(async () => {
      const { scope } = await d.identity.ensureDemoUser();
      const s = d.platform.scoped(scope);
      await reset(s);
      return d.generate(s);
    });
  }

  return { ensure, recreate };
}

export type Demo = ReturnType<typeof makeDemo>;
