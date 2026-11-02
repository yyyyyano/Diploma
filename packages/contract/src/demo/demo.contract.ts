// Демо-вход (DEMO-04, AUTH-08): «Войти как демо-пользователь» на странице входа. Доступ ставит сервер: localOnly — только с
// локального слушателя (на сетевом процедуры нет, как у первого запуска); сессия — cookie kosht_session в ответе, пароль не нужен.
// «Пересоздать демо-данные» (DEMO-03) — в ветке admin (`admin.recreateDemo`).
import { oc } from "@orpc/contract";
import { SessionUser } from "../identity/identity.contract.ts";
import { pickErrors } from "../errors.ts";

export const demoContract = {
  /** Демо создаётся, если его ещё нет (первый вход ждёт запись данных); ответ — как у входа по паролю. */
  signIn: oc
    .route({ method: "POST", path: "/demo/sign-in" })
    .output(SessionUser)
    .errors(pickErrors("NOT_FOUND", "ACCOUNT_BLOCKED", "UNAVAILABLE", "INTERNAL")),
};
