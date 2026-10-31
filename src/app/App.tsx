import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installGlobalErrorHandlers } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { t } from "@/i18n";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { createAppRouter } from "./router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});
const router = createAppRouter();

export function App() {
  useEffect(
    () =>
      installGlobalErrorHandlers((error) => {
        logger.error("Error no controlado", { error, reference: error.correlationId });
        toast.error(t("error.title"), {
          description: t("error.reference", { id: error.correlationId }),
        });
      }),
    [],
  );

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
