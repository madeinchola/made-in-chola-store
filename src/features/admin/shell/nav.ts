import type { ComponentType, SVGProps } from "react";
import { Coins, Layers, LayoutDashboard, ScrollText, Settings, Shirt, Tags } from "lucide-react";
import type { MessageKey } from "@/i18n";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
interface NavItem {
  to: string;
  label: MessageKey;
  icon: Icon;
  end?: boolean;
}

export const ADMIN_NAV: readonly NavItem[] = [
  { to: "/admin", label: "admin.nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/productos", label: "admin.nav.products", icon: Shirt },
  { to: "/admin/categorias", label: "admin.nav.categories", icon: Tags },
  { to: "/admin/colecciones", label: "admin.nav.collections", icon: Layers },
  { to: "/admin/monedas", label: "admin.nav.currencies", icon: Coins },
  { to: "/admin/ajustes", label: "admin.nav.settings", icon: Settings },
  { to: "/admin/auditoria", label: "admin.nav.audit", icon: ScrollText },
];
