import { RequireAdmin } from "@/features/auth/guards";

/** Todo `/admin/*` pasa por RequireAdmin. El shell visual del panel llega en el Sprint 3. */
export function AdminLayout() {
  return <RequireAdmin />;
}
