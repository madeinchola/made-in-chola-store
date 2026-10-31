/* Utilidades SOLO de tests de los layouts (exportan datos y funciones junto a componentes de apoyo). */
/* eslint-disable react-refresh/only-export-components */
import type { ReactElement } from "react";
import { configure, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AuthContextValue } from "@/features/auth/auth-context";
import type { CategoryNode } from "@/features/catalog/types";
import { fakeAuth, WithAuth } from "@/test/auth-test-utils";

// Las pantallas esperan datos asíncronos (mocks de red). Con la máquina cargada 1 s (valor por defecto) se queda corto
// y da fallos intermitentes; 4 s sigue fallando rápido si de verdad no aparece.
configure({ asyncUtilTimeout: 4000 });

const base = {
  parentId: null,
  description: null,
  sortOrder: 0,
  children: [] as CategoryNode[],
};

const node = (id: string, name: string, over: Partial<CategoryNode> = {}): CategoryNode => ({
  ...base,
  id,
  name,
  slug: name.toLowerCase(),
  ...over,
});

/** Mujer (2 hijas) · Hombre (sin hijas) · Accesorios (1 hija). */
export const CATEGORIES: CategoryNode[] = [
  node("c1", "Mujer", {
    children: [
      node("c1a", "Vestidos", { parentId: "c1" }),
      node("c1b", "Faldas", { parentId: "c1" }),
    ],
  }),
  node("c2", "Hombre"),
  node("c3", "Accesorios", { children: [node("c3a", "Sombreros", { parentId: "c3" })] }),
];

/** Muestra la ruta actual para comprobar a dónde se navegó. */
export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</p>;
}

/** Renderiza con QueryClient, sesión falsa y router en memoria (sin reintentos: los fallos se ven al instante). */
export function renderWithApp(
  ui: ReactElement,
  { auth = fakeAuth(), path = "/" }: { auth?: AuthContextValue; path?: string } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WithAuth value={auth}>
        <MemoryRouter initialEntries={[path]}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
}
