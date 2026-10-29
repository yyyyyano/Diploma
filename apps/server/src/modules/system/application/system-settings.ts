// Экран «Система» (ADM-60, NFR-22, NFR-23, NFR-24, OBS-05, OBS-07) — то, что принадлежит платформе, а не модулям:
// фоновые задачи (журнал background_job_run и расписания процесса), часовой пояс, доступ с других устройств, Langfuse.
// Пояс меняет «сегодня» сразу (часы читают настройку clock.time-zone; кэш этого процесса прогревается при записи,
// остальные процессы увидят её в пределах кэша настроек); расписания worker берут пояс при старте — экран говорит, что
// они сменятся после перезапуска worker. Доступ из сети открывает и закрывает слушатель lan без перезапуска: он
// сверяется с настройкой network.allow-lan раз в секунду (platform/http/listeners.ts).
import { AppError } from "../../../platform/errors/app-error.ts";
import type { JobsOverview } from "../../../platform/jobs/jobs.ts";
import { ALLOW_LAN } from "../../../platform/http/allow-lan.ts";
import { LAN_ADDRESS } from "../../../platform/http/link-origin.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { TIME_ZONE } from "../../../platform/settings/time-zone.ts";

export interface SystemView {
  readonly jobs: JobsOverview;
  readonly timeZone: string;
  readonly lan: { readonly allowed: boolean; readonly address: string };
  readonly langfuse: { readonly enabled: boolean; readonly url: string | null };
}

export function makeSystemSettings(d: Pick<Platform, "settings" | "jobs" | "telemetry" | "log">) {
  async function view(): Promise<SystemView> {
    const langfuse = d.telemetry.langfuse;
    return {
      jobs: await d.jobs.overview(),
      timeZone: await d.settings.get(TIME_ZONE),
      lan: {
        allowed: await d.settings.get(ALLOW_LAN),
        address: await d.settings.get(LAN_ADDRESS),
      },
      langfuse: { enabled: langfuse !== undefined, url: langfuse?.baseUrl ?? null },
    };
  }

  /** Новый пояс (IANA); неизвестный — VALIDATION (схема настройки). «Сегодня» этого процесса меняется сразу. */
  async function setTimeZone(timeZone: string): Promise<void> {
    await d.settings.set(TIME_ZONE, timeZone);
    await d.settings.get(TIME_ZONE);
  }

  /**
   * Открыть или закрыть вход из сети и задать адрес компьютера для ссылок; адрес не по схеме — VALIDATION.
   * Открыть без адреса — тоже VALIDATION (NFR-24): ссылки в письмах строятся только по настройке, не по Host запроса,
   * и без адреса телефон получил бы ссылку на 127.0.0.1.
   */
  async function setLan(input: { readonly allowed: boolean; readonly address: string }) {
    if (input.allowed && input.address === "") {
      throw new AppError("VALIDATION", { setting: LAN_ADDRESS.key });
    }
    // Адрес — первым: не прошёл схему — VALIDATION, и доступ не переключён.
    await d.settings.set(LAN_ADDRESS, input.address);
    await d.settings.set(ALLOW_LAN, input.allowed);
    d.log.info({ status: input.allowed ? "lan-open" : "lan-closed" }, "system.lan-changed");
  }

  return { view, setTimeZone, setLan };
}

export type SystemSettings = ReturnType<typeof makeSystemSettings>;
