// globalSetup проекта int (vitest.config.ts): шаблонная база из боевых миграций (test-template.ts) — тестовые файлы
// клонируют её (createTestDb из @kosht/testing/db) и получают подключения через inject("testDb").
import type { TestProject } from "vitest/node";
import { prepareServerTemplate } from "./test-template.ts";

export default async function setup(project: TestProject): Promise<void> {
  project.provide("testDb", await prepareServerTemplate());
}
