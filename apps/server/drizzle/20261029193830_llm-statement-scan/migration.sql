-- Руками (T-024): задача statement.scan — скан выписки (изображение, ответ по схеме); цепочка как у чеков: облачная
-- модель с изображениями Groq → Z.ai → локальная (решение пользователя 2026-10-29: при облачном согласии скан уходит в
-- облако как есть, без согласия — локально; PRIV-04). Модели те же, что у receipt.extract (T-023).
INSERT INTO "llm_task_chains" ("task", "model_id", "position") VALUES
  ('statement.scan', 'groq/qwen/qwen3.8-27b', 1),
  ('statement.scan', 'zai/glm-4.6v-flash', 2),
  ('statement.scan', 'llama/qwen3.5-4b', 3);
