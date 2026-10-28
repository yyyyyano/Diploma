// Процедуры privacy (contract.privacy.*): authed — вкладка «Конфиденциальность» (облачное согласие и история) и
// «Мои данные» (архив: состояние и заявка).
import type { DataExportState, PrivacyState } from "@kosht/contract";
import { authed } from "../../../platform/http/procedures.ts";
import type { DataExport, DataExportView } from "../application/data-export.ts";
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

/** Архив на проводе: моменты — ISO UTC, отсутствующее — null. */
export function toDataExportDto(view: DataExportView): DataExportState {
  return {
    status: view.status,
    requestedAt: view.requestedAt?.toISOString() ?? null,
    finishedAt: view.finishedAt?.toISOString() ?? null,
    file: view.file ?? null,
  };
}

export function privacyRouter(
  uc: CloudConsentSettings,
  exports: Pick<DataExport, "state" | "request">,
) {
  return {
    state: authed.privacy.state.handler(async ({ context }) =>
      toPrivacyStateDto(await uc.state(context.s)),
    ),
    setCloudConsent: authed.privacy.setCloudConsent.handler(async ({ input, context }) =>
      toPrivacyStateDto(await uc.setCloudConsent(context.s, input)),
    ),
    dataExport: authed.privacy.dataExport.handler(async ({ context }) =>
      toDataExportDto(await exports.state(context.s)),
    ),
    requestExport: authed.privacy.requestExport.handler(async ({ context }) =>
      toDataExportDto(await exports.request(context.s)),
    ),
  };
}
