// Процесс api с тестовым источником сессий — для теста остановки по SIGTERM при открытом events.stream
// (processes.int.test.ts): боевой entrypoints/api.ts тестовыми сессиями не нагружается. Заголовок x-test-user: a —
// пользователь testUserId(1) домохозяйства testHouseholdId(1); без него сессии нет (источник сайта — T-009).
import { testHouseholdId, testUserId } from "@kosht/testing";
import { runProcess } from "../run.ts";

await runProcess("api", {
  setup: (composition) => {
    composition.sessions.register(async (headers) =>
      headers.get("x-test-user") === "a"
        ? { userId: testUserId(1), householdId: testHouseholdId(1), role: "user" }
        : undefined,
    );
  },
});
