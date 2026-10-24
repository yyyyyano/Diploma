// Общие схемы «на проводе» (ARCHITECTURE §9, .claude/rules/api-contract.md). Деньги и дни — из kernel, без копий:
// одна схема проверяет и вход сервера, и форму сайта. Деньги — `Money` (целые копейки + код валюты), рядом с
// расчётным числом — `traceId`; отформатированных строк сумм на проводе нет.
import { z } from "zod";

export { LocalDate, Money } from "@kosht/kernel";

/** Номер страницы списка (TXN-02): с 1. */
export const PageNumber = z.int().min(1);

/** Размер страницы списка (TXN-02): 1..100, по умолчанию 50 строк. */
export const PageSize = z.int().min(1).max(100).default(50);

/** Сколько всего строк в списке (`total`): для номеров страниц и «Показать ещё». */
export const RowCount = z.int().min(0);

/**
 * Вид объекта для сайта и агента — машинное имя в kebab-case («receipt», «statement-import»): в событиях сайта, в
 * выбранном объекте контекста страницы, в карточке чата. Пользователю не показывается.
 */
export const EntityKind = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);

/** Id объекта на проводе (ARCHITECTURE §7: все id — uuidv7); бренд конкретного id — в схеме модуля. */
export const EntityId = z.uuid();
