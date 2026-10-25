// События identity (ADR-0004, ARCHITECTURE §5): нагрузка — пачка id пользователей, других данных нет (OBS-04).
// Подписчик перечитывает состояние сам через ctx.s — владелец задачи и есть этот пользователь.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

const UserIds = z.object({ ids: z.array(z.uuid()).min(1) });

/** Первый запуск пройден (AUTH-10): ids — администратор. Загрузку законов и моделей запустят T-034 и T-024. */
export const systemInitialized = defineEvent({
  name: "identity.system-initialized",
  payload: UserIds,
});

/** Пользователь заведён (первый запуск, регистрация T-012): accounts создаёт «Наличные» (STMT-01). */
export const userRegistered = defineEvent({ name: "identity.user-registered", payload: UserIds });
