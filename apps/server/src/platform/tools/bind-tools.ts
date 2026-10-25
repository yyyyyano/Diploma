// Адаптер инструментов агента (ADR-0009, ARCHITECTURE §6.4, §8.2): описания defineTool модулей → исполнители для
// цикла агента. ctx.s строится здесь из scope запуска агента — «чьи данные» не приходят из аргументов модели.
// Аргументы модели проверяет схема входа (не прошли — { ok: false, code: "VALIDATION" }); AppError инструмента —
// { ok: false, code } (агент сообщает и предлагает повторить, AGT-13); прочее — стек в лог и { ok: false, code:
// "INTERNAL" } без текста. destructive только предлагает ожидающее действие (AGT-07): исполняет его код после «Да».
// AI SDK здесь не нужен: обёртку в tool() делает агент.
import type { PageContext } from "@kosht/contract";
import type { Scope } from "@kosht/kernel";
import type { ScopedDb } from "../db/scoped-db.ts";
import { AppError } from "../errors/app-error.ts";
import type { Logger } from "../logging/logger.ts";
import type { ToolChannel, ToolDef, ToolInput } from "./define-tool.ts";

/** Ошибка инструмента для модели: код каталога, без текста. */
export interface ToolFailure {
  readonly ok: false;
  readonly code: string;
}

export interface BoundTool {
  readonly name: string;
  readonly description: string;
  readonly input: ToolInput;
  execute(args: unknown): Promise<unknown>;
}

export interface ToolLaunch {
  /** Scope запуска агента (сессия сайта или привязка Telegram). */
  readonly scope: Scope;
  readonly scoped: (scope: Scope) => ScopedDb;
  readonly requestId: string;
  readonly channel: ToolChannel;
  readonly page?: PageContext;
  readonly log: Logger;
}

export function bindTools(defs: readonly ToolDef[], launch: ToolLaunch): BoundTool[] {
  const ctx = {
    s: launch.scoped(launch.scope),
    requestId: launch.requestId,
    channel: launch.channel,
    ...(launch.page === undefined ? {} : { page: launch.page }),
  };
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    input: def.input,
    async execute(args): Promise<unknown> {
      const parsed = def.input.safeParse(args);
      if (!parsed.success) return { ok: false, code: "VALIDATION" } satisfies ToolFailure;
      try {
        if (def.kind === "destructive")
          return { ok: true, pending: await def.propose(ctx, parsed.data) };
        return def.output.parse(await def.execute(ctx, parsed.data));
      } catch (error) {
        if (error instanceof AppError) return { ok: false, code: error.code } satisfies ToolFailure;
        launch.log.error({ err: error, code: "INTERNAL" }, "agent.tool-failed");
        return { ok: false, code: "INTERNAL" } satisfies ToolFailure;
      }
    },
  }));
}
