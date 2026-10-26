// Процедуры privacy (contract.privacy.*): authed — вкладка «Конфиденциальность»: облачное согласие и история.
import type { PrivacyState } from "@kosht/contract";
import { authed } from "../../../platform/http/procedures.ts";
import type {
  CloudConsentSettings,
  PrivacyStateView,
} from "../application/cloud-consent-settings.ts";

/** Состояние на проводе: моменты — ISO UTC. */
export function toPrivacyStateDto(view: PrivacyStateView): PrivacyState {
  return {
    cloud: { granted: view.cloud.granted, since: view.cloud.since?.toISOString() ?? null },
    history: view.history.map((record) => ({
      id: record.id,
      kind: record.kind,
      granted: record.granted,
      textVersion: record.textVersion,
      at: record.at.toISOString(),
    })),
  };
}

export function privacyRouter(uc: CloudConsentSettings) {
  return {
    state: authed.privacy.state.handler(async ({ context }) =>
      toPrivacyStateDto(await uc.state(context.s)),
    ),
    setCloudConsent: authed.privacy.setCloudConsent.handler(async ({ input, context }) =>
      toPrivacyStateDto(await uc.setCloudConsent(context.s, input)),
    ),
  };
}
