// Клиент процедур (ADR-0005, ADR-0013): типизированный клиент oRPC по контракту @kosht/contract поверх REST
// (OpenAPILink ↔ OpenAPIHandler сервера под /api) и queryOptions/mutationOptions для TanStack Query. Других путей к
// серверу у сайта нет (frontend-feature.md): fetch мимо этого клиента — нельзя.
import { contract } from "@kosht/contract";
import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

/** Префикс процедур сервера (platform/http/api.ts). */
export const API_PREFIX = "/api";

/** Ответы REST — JSON: даты и прочее приходят «как на проводе» (JsonifiedClient). */
export type ApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>;

/** Клиент своего же адреса: cookie сессии идут сами (same-origin), в разработке — через прокси Vite. */
export function createApiClient(origin: () => string = () => window.location.origin): ApiClient {
  const link = new OpenAPILink(contract, { url: () => `${origin()}${API_PREFIX}` });
  return createORPCClient(link);
}

export const client: ApiClient = createApiClient();

export const orpc = createTanstackQueryUtils(client);
