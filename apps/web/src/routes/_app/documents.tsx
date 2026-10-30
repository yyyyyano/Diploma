// «Чеки и документы» (STMT-03, STMT-04, STMT-11): загрузка и предпросмотр выписок. Страница — features/documents.
import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { DocumentsPage } from "../../features/documents/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/documents")({
  staticData: {
    page: "documents",
    nav: { group: "money", order: 20, section: "documents", icon: FileText },
  },
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16), а не граница ошибок.
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.statements.list.queryOptions()),
  component: DocumentsPage,
});
