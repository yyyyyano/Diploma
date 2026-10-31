// Инструмент агента (AGT-03, AGT-05, AGT-07, ADR-0009, ARCHITECTURE §8.2): модуль-владелец описывает его в
// agent/tools.ts — без AI SDK; корень композиции собирает реестр, а агент получает инструменты оттуда и не
// импортирует предметные модули. read/write выполняются сразу (write регистрирует отмену в actions и возвращает
// undoToken); destructive (удаление, массовое) только предлагает ожидающее действие — исполняет его код после «Да»
// человека, поэтому execute у него нет по типу. «Чьи данные» — только ctx.s из scope запуска агента (§6.4).
import type { PageContext } from "@kosht/contract";
import type { z } from "zod";
import type { ScopedDb } from "../db/scoped-db.ts";

/** Наборы инструментов: префикс подсказки постоянен ради кэша провайдера — новый набор только через ADR. */
export const TOOLSETS = ["core", "legal", "planning", "reports"] as const;
export type Toolset = (typeof TOOLSETS)[number];

export type ToolKind = "read" | "write" | "destructive";

/** Откуда пришёл запуск агента. */
export type ToolChannel = "web" | "telegram";

/** Что получает инструмент: данные — только через s (scope запуска агента), страница — что видит пользователь. */
export interface ToolCtx {
  readonly s: ScopedDb;
  readonly requestId: string;
  readonly channel: ToolChannel;
  readonly page?: PageContext;
}

/**
 * Ожидающее действие (AGT-07): решение «Да/Нет» уже создано модулем-владельцем в `actions` (id) и показывает, сколько
 * объектов заденет «Да». Один вид результата у всех destructive-инструментов: по нему агент узнаёт, на какое решение
 * отвечает короткое «да» (AGT-07), а карточка подтверждения показывает число.
 */
export interface PendingActionDraft {
  readonly decisionId: string;
  readonly count: number;
}

/** Вход инструмента — Zod-объект: агент передаёт аргументы модели, адаптер проверяет их схемой. */
export type ToolInput = z.ZodObject;

interface ToolBase<S extends ToolInput> {
  /** snake_case латиницей: имя видит модель. */
  readonly name: string;
  readonly toolset: Toolset;
  /** Коротко и по-английски: когда вызывать и что вернёт. */
  readonly description: string;
  readonly input: S;
}

/** read — чтение; write — одиночное действие с отменой (AGT-05): оба выполняются сразу. */
export interface ImmediateTool<
  S extends ToolInput = ToolInput,
  O extends z.ZodType = z.ZodType,
> extends ToolBase<S> {
  readonly kind: "read" | "write";
  /** Схема результата (карточка из @kosht/contract): компактно, числа — из calc с traceId. */
  readonly output: O;
  execute(ctx: ToolCtx, input: z.output<S>): Promise<z.input<O>>;
  readonly propose?: never;
}

/** Удаление и массовые действия (AGT-07): только ожидающее действие в actions, исполняет код после «Да». */
export interface DestructiveTool<S extends ToolInput = ToolInput> extends ToolBase<S> {
  readonly kind: "destructive";
  propose(ctx: ToolCtx, input: z.output<S>): Promise<PendingActionDraft>;
  readonly execute?: never;
  readonly output?: never;
}

export type ToolDef = ImmediateTool | DestructiveTool;

const TOOL_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
/** Печатаемый ASCII: описание видит модель в префиксе — по-английски (агентское правило). */
const ENGLISH = /^[\x20-\x7E]+$/;
/** «Чьи данные» не приходят из аргументов модели (ARCHITECTURE §6.4; статически — isolation.mjs). */
const OWNER_KEYS = ["userId", "householdId", "ownerId"] as const;

export function defineTool<S extends ToolInput, O extends z.ZodType>(
  definition: ImmediateTool<S, O>,
): ImmediateTool<S, O>;
export function defineTool<S extends ToolInput>(definition: DestructiveTool<S>): DestructiveTool<S>;
export function defineTool(definition: ToolDef): ToolDef {
  const { name, toolset, description, input } = definition;
  if (!TOOL_NAME.test(name)) {
    throw new RangeError(`Имя инструмента «${name}»: ожидается snake_case латиницей.`);
  }
  if (!TOOLSETS.some((known) => known === toolset)) {
    throw new RangeError(
      `Инструмент ${name}: набор «${String(toolset)}» не из ${TOOLSETS.join(", ")}.`,
    );
  }
  if (!ENGLISH.test(description)) {
    throw new RangeError(`Инструмент ${name}: описание — коротко, English (ASCII), не пустое.`);
  }
  const owner = OWNER_KEYS.find((key) => key in input.shape);
  if (owner !== undefined) {
    throw new RangeError(
      `Инструмент ${name}: поле ${owner} во входе — «чьи данные» берутся только из ctx.s (ARCHITECTURE §6.4).`,
    );
  }
  // Типы уже это запрещают; проверка — для описаний, собранных в обход типов (as).
  if (definition.kind === "destructive") {
    if ("execute" in definition) {
      throw new RangeError(
        `Инструмент ${name}: destructive не выполняет действие сам — только propose.`,
      );
    }
  } else if (typeof definition.execute !== "function" || "propose" in definition) {
    throw new RangeError(
      `Инструмент ${name}: ${definition.kind} выполняется сразу — нужен execute без propose.`,
    );
  }
  return definition;
}
