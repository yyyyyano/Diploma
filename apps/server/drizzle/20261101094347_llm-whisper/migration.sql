-- Руками (T-043): локальное распознавание речи — whisper.cpp (VOICE-03). Запись реестра и вторая ступень цепочки
-- `transcribe`: Groq Whisper при облачном согласии, иначе или при недоступности облака — whisper-server на этом
-- компьютере (профиль models, Compose). Модель whisper.cpp грузит загрузчик локальных моделей (каталог llm),
-- облачной записи без согласия цепочка не берёт (PRIV-02).
INSERT INTO "llm_models" ("id", "provider", "model_id", "cloud", "capabilities", "priority", "enabled", "context_tokens", "rpm", "tpm", "rpd", "tpd", "user_selectable") VALUES
  ('whisper/large-v3-turbo-q5_0', 'whisper', 'large-v3-turbo-q5_0', false, ARRAY['speech'], 91, true, 0, NULL, NULL, NULL, NULL, false);
--> statement-breakpoint
INSERT INTO "llm_task_chains" ("task", "model_id", "position") VALUES
  ('transcribe', 'whisper/large-v3-turbo-q5_0', 2);
