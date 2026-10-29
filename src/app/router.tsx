import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { PublicLayout } from "./layouts/PublicLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { AdminHomePage } from "./pages/AdminHomePage";
import { AccountPage } from "./pages/AccountPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { RequireAuth } from "@/features/auth/guards";

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
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
    path: "admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminHomePage /> },
      { path: "*", element: <PlaceholderPage /> },
    ],
  },
  { path: "*", element: <PublicLayout />, children: [{ path: "*", element: <NotFoundPage /> }] },
];

export const createAppRouter = () => createBrowserRouter(routes);
