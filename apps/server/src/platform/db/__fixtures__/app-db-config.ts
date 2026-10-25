// DbConfig роли приложения к тестовой базе файла — для кода, который сам открывает соединение (LISTEN, T-061), а не
// берёт пул TestDb. Пароль — во временном файле 0600, как secrets/db_app_password у приложения; файл удаляет cleanup().
import type { TestDb } from "@kosht/testing/db";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inject } from "vitest";
import type { DbConfig } from "../../config/config.ts";

export interface AppDbConfig {
  readonly config: DbConfig;
  cleanup(): void;
}

export function appDbConfig(db: TestDb): AppDbConfig {
  const { app } = inject("testDb");
  const dir = mkdtempSync(join(tmpdir(), "kosht-app-db-"));
  const passwordFile = join(dir, "db_app_password");
  writeFileSync(passwordFile, app.password, { mode: 0o600 });
  return {
    config: {
      url: `postgres://${encodeURIComponent(app.user)}@${app.host}:${String(app.port)}/${db.name}`,
      passwordFile,
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
