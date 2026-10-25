// Типы pino-roll 4.0.0 (пакет без своих .d.ts): только используемые параметры — README пакета, раздел «Options».
// Возвращает поток SonicBoom; здесь — та его часть, которая нужна логгеру.
declare module "pino-roll" {
  import type { EventEmitter } from "node:events";
  import type { DestinationStream } from "pino";

  interface PinoRollOptions {
    readonly file: string;
    readonly frequency?: "daily" | "hourly" | "weekly" | number;
    readonly dateFormat?: string;
    readonly extension?: string;
    readonly size?: string | number;
    readonly limit?: { readonly count: number; readonly removeOtherLogFiles?: boolean };
    readonly mkdir?: boolean;
    readonly mode?: number;
    readonly symlink?: boolean;
  }

  export interface RollStream extends DestinationStream, EventEmitter {
    /** Путь текущего файла; null, пока файл не открыт (до события «ready»). */
    readonly file: string | null;
    end(): void;
  }

  export default function pinoRoll(options: PinoRollOptions): Promise<RollStream>;
}
