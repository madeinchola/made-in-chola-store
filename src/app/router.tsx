import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { PublicLayout } from "./layouts/PublicLayout";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { AccountPage } from "./pages/AccountPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { RouteError } from "@/components/RouteError";
import { RequireAdmin, RequireAuth } from "@/features/auth/guards";
import { lazyPage } from "./lazyPage";

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "login", element: <LoginPage /> },
      { path: "registro", element: <RegisterPage /> },
      { path: "recuperar", element: <ForgotPasswordPage /> },
      { path: "restablecer", element: <ResetPasswordPage /> },
      { element: <RequireAuth />, children: [{ path: "cuenta", element: <AccountPage /> }] },
      { path: "producto/:slug", element: <PlaceholderPage /> },
      { path: "categoria/:slug", element: <PlaceholderPage /> },
      { path: "coleccion/:slug", element: <PlaceholderPage /> },
    ],
  },
  {
    // Todo /admin/* pasa por RequireAdmin (solo UX: la autorización real es la RLS de la base en cada consulta).
    path: "admin",
    element: <RequireAdmin />,
    errorElement: <RouteError />,
    children: [
      {
        element: lazyPage(() => import("@/features/admin/shell/AdminShell"), "AdminShell"),
        children: [
          {
            index: true,
            element: lazyPage(
              () => import("@/features/admin/pages/DashboardPage"),
              "DashboardPage",
            ),
          },
          {
            path: "productos",
            children: [
              {
                index: true,
                element: lazyPage(
                  () => import("@/features/admin/products/ProductsListPage"),
                  "ProductsListPage",
                ),
              },
              {
                path: "nuevo",
                element: lazyPage(
                  () => import("@/features/admin/products/ProductCreatePage"),
                  "ProductCreatePage",
                ),
              },
              {
                path: ":id",
                element: lazyPage(
                  () => import("@/features/admin/products/ProductEditPage"),
                  "ProductEditPage",
                ),
              },
            ],
          },
          {
            path: "categorias",
            element: lazyPage(
              () => import("@/features/admin/taxonomy/CategoriesPage"),
              "CategoriesPage",
            ),
          },
          {
            path: "colecciones",
            element: lazyPage(
              () => import("@/features/admin/taxonomy/CollectionsPage"),
              "CollectionsPage",
            ),
          },
          {
            path: "monedas",
            element: lazyPage(
              () => import("@/features/admin/config/CurrenciesPage"),
              "CurrenciesPage",
            ),
          },
          {
            path: "ajustes",
            element: lazyPage(() => import("@/features/admin/config/SettingsPage"), "SettingsPage"),
          },
          {
            path: "auditoria",
            element: lazyPage(() => import("@/features/admin/audit/AuditPage"), "AuditPage"),
          },
          { path: "*", element: <PlaceholderPage /> },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [{ path: "*", element: <NotFoundPage /> }],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
