// Блокировка, роль и удаление с защитой последнего администратора (AUTH-11, AUTH-12, ADR-0016): одна проверка для всех
// трёх действий — в транзакции под блокировкой строк активных администраторов (lockActiveAdmins, FOR UPDATE), иначе
// два администратора, одновременно снимающие роль друг с друга, оставили бы систему без администратора. Блокировка
// сразу завершает все сессии пользователя (cookieCache выключен — следующий запрос уже без входа). Экраны админки —
// T-017; удаление аккаунта (PRIV-06) — T-016: оба зовут это через фасад identity.
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import {
  deleteSessions,
  lockActiveAdmins,
  updateUserAccess,
  type IdentityDb,
  type UserRole,
  type UserStatus,
} from "../infrastructure/db/identity.repo.ts";

/** Пользователь — активный администратор, и других активных нет: его нельзя лишить роли, заблокировать, удалить. */
async function ensureNotLastAdmin(db: IdentityDb, userId: string): Promise<void> {
  const admins = await lockActiveAdmins(db);
  if (admins.includes(userId) && admins.length <= 1) throw new AppError("LAST_ADMIN");
}

export function makeAdminGuard(d: Pick<SystemPlatform, "system" | "clock" | "log">) {
  /** Заблокировать или разблокировать; блокировка завершает сессии; последнего администратора — LAST_ADMIN. */
  async function setStatus(userId: string, status: UserStatus): Promise<void> {
    await d.system.transaction(async (tx) => {
      if (status === "blocked") await ensureNotLastAdmin(tx, userId);
      if (!(await updateUserAccess(tx, userId, { status }, d.clock.now()))) {
        throw new AppError("NOT_FOUND");
      }
      if (status === "blocked") await deleteSessions(tx, userId);
    });
    d.log.info({ userId, status }, "identity.user-status-changed");
  }

  /** Назначить или снять роль администратора; снять у последнего — LAST_ADMIN. */
  async function setRole(userId: string, role: UserRole): Promise<void> {
    await d.system.transaction(async (tx) => {
      if (role !== "admin") await ensureNotLastAdmin(tx, userId);
      if (!(await updateUserAccess(tx, userId, { role }, d.clock.now()))) {
        throw new AppError("NOT_FOUND");
      }
    });
    d.log.info({ userId, role }, "identity.user-role-changed");
  }

  /**
   * Перед удалением пользователя: в транзакции удаления (db — её построитель) — последнего администратора удалить
   * нельзя. Блокировка строк держится до конца той транзакции.
   */
  async function assertRemovable(db: IdentityDb, userId: string): Promise<void> {
    await ensureNotLastAdmin(db, userId);
  }

  return { setStatus, setRole, assertRemovable };
}

export type AdminGuard = ReturnType<typeof makeAdminGuard>;
