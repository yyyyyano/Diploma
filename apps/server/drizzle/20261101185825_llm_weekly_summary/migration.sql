-- WEEK-02 (T-050): задача шлюза «итоги недели» — текст по готовым числам; цепочка как у остальных структурных задач:
-- Groq, затем Z.ai, затем локальная модель.
INSERT INTO "llm_task_chains" ("task", "model_id", "position") VALUES
  ('weekly.summary', 'groq/openai/gpt-oss-120b', 1), ('weekly.summary', 'zai/glm-4.7-flash', 2), ('weekly.summary', 'llama/qwen3.5-4b', 3);
