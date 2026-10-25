// Бренды id (ARCHITECTURE §5.3, §7): все id — uuidv7, но id пользователя, домохозяйства и трассы — разные типы,
// чтобы их нельзя было перепутать. Схема одновременно разбирает вход: `UserId.parse(text)`.
import { z } from "zod";

export const UserId = z.uuid().brand<"UserId">();
export type UserId = z.infer<typeof UserId>;

/** Домохозяйство — граница изоляции данных (ROLE-01); в MVP у каждого пользователя своё (задел DIP-03). */
export const HouseholdId = z.uuid().brand<"HouseholdId">();
export type HouseholdId = z.infer<typeof HouseholdId>;

/** Сохранённая трасса расчёта (EXPL-02): по ней «Откуда эта цифра?» показывает тот самый расчёт. */
export const TraceId = z.uuid().brand<"TraceId">();
export type TraceId = z.infer<typeof TraceId>;

/**
 * Файл пользователя (SEC-03): имя на диске — data/files/<HouseholdId>/<FileId>. Схема пропускает только uuid, поэтому
 * id из запроса не превратится в путь вроде «../». Здесь, а не в contract: id файла нужен и схемам БД (T-016), а
 * серверный код контракт как источник типов не использует.
 */
export const FileId = z.uuid().brand<"FileId">();
export type FileId = z.infer<typeof FileId>;
