// Перепроверка владельца задачи (ARCHITECTURE §5, SEC-04): пользователь существует, активен и состоит в том же
// домохозяйстве, что в конверте; иначе задача отбрасывается (platform/jobs).
import type { ScopeVerifier } from "../../../platform/jobs/scope-verifier.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { isActiveMember } from "../infrastructure/db/identity.repo.ts";

export function makeScopeVerifier(d: Pick<SystemPlatform, "system">): ScopeVerifier {
  return (candidate) => isActiveMember(d.system, candidate);
}
