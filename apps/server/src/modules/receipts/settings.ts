// Настройки распознавания чеков (RCPT-05, RCPT-06, SEC-03): допуск арифметики, число перепроверок, предел потока
// подготовки фото. Пороги — настройки, а не константы в коде (.claude/rules/backend-module.md).
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** Допуск арифметики чека, копейки: разница не больше — сходится (RCPT-05: ±0,01 BYN по умолчанию). */
export const RECEIPTS_TOLERANCE_MINOR = defineSetting({
  key: "receipts.tolerance-minor",
  schema: z.int().min(0).max(100),
  default: 1,
});

/** Сколько раз перепроверять спорные места (RCPT-06: не больше двух по умолчанию). 0 — не перепроверять. */
export const RECEIPTS_MAX_RECHECKS = defineSetting({
  key: "receipts.max-rechecks",
  schema: z.int().min(0).max(5),
  default: 2,
});

/** Срок подготовки фото в потоке, мс: HEIC на 12 Мп — около 3 с, дольше — поток прерывается (SEC-03). */
export const RECEIPTS_PREPARE_TIMEOUT_MS = defineSetting({
  key: "receipts.prepare-timeout-ms",
  schema: z.int().min(1_000).max(600_000),
  default: 60_000,
});

/** Предел памяти потока подготовки фото, МБ (куча V8; декодер HEIC держит кадр в ней). */
export const RECEIPTS_PREPARE_MEMORY_MB = defineSetting({
  key: "receipts.prepare-memory-mb",
  schema: z.int().min(128).max(4_096),
  default: 1_024,
});

/** Длинная сторона копии фото для модели, пиксели: больше не нужно для чтения, но дороже по токенам и времени. */
export const RECEIPTS_IMAGE_MAX_SIDE = defineSetting({
  key: "receipts.image-max-side",
  schema: z.int().min(800).max(4_096),
  default: 2_000,
});
