// «Чеки и документы» (STMT-03, STMT-04, STMT-11): загрузка и предпросмотр выписок. Страница — features/documents.
import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { DocumentsPage, DocumentsSearch } from "../../features/documents/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/documents")({
  validateSearch: DocumentsSearch,
  staticData: {
    page: "documents",
    nav: { group: "money", order: 20, section: "documents", icon: FileText },
  },
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16), а не граница ошибок.
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.statements.list.queryOptions()),
  component: function DocumentsRoute() {
    const search = Route.useSearch();
    // Другой импорт (STMT-10) или чек (RCPT-11) по ссылке — страница с нуля: открытое берётся из адреса при монтировании.
    return <DocumentsPage key={`${search.import ?? ""}${search.open ?? ""}`} search={search} />;
  },
});
