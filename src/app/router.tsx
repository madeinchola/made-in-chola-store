import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { PublicLayout } from "./layouts/PublicLayout";
import { HomePage } from "@/features/storefront/home/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RouteError } from "@/components/RouteError";
import { RequireAdmin, RequireAuth } from "@/features/auth/guards";
import { lazyPage } from "./lazyPage";
import { UI_GUIDE_ENABLED } from "./uiGuide";

const listing = () => import("@/features/storefront/listing/ListingPages");
// Cuentas: formularios con react-hook-form y zod, que la tienda no necesita para pintar la portada ni una ficha.
const login = () => import("./pages/LoginPage");
const register = () => import("./pages/RegisterPage");
const forgot = () => import("./pages/ForgotPasswordPage");
const reset = () => import("./pages/ResetPasswordPage");
const accountLayout = () => import("@/features/account/AccountLayout");
const profile = () => import("@/features/account/profile/ProfilePage");
const addresses = () => import("@/features/account/addresses/AddressesPage");
const taxProfiles = () => import("@/features/account/tax/TaxProfilesPage");
const orders = () => import("@/features/account/orders/OrdersPage");
const security = () => import("@/features/account/security/SecurityPage");
const orderDetail = () => import("@/features/account/orders/OrderDetailPage");
// Bolsa: la página (y con ella sus líneas, el resumen y las sugerencias) no entra en la carga inicial.
const cartPage = () => import("@/features/cart/CartPage");
// Checkout y confirmación (S10): solo las descarga quien llega a pagar.
const checkoutPage = () => import("@/features/checkout/CheckoutPage");
const confirmationPage = () => import("@/features/checkout/OrderConfirmationPage");

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "login", element: lazyPage(login, "LoginPage") },
      { path: "registro", element: lazyPage(register, "RegisterPage") },
      { path: "recuperar", element: lazyPage(forgot, "ForgotPasswordPage") },
      { path: "restablecer", element: lazyPage(reset, "ResetPasswordPage") },
      {
        element: <RequireAuth />,
        children: [
          {
            path: "cuenta",
            element: lazyPage(accountLayout, "AccountLayout"),
            children: [
              { index: true, element: lazyPage(profile, "ProfilePage") },
              { path: "direcciones", element: lazyPage(addresses, "AddressesPage") },
              { path: "datos-fiscales", element: lazyPage(taxProfiles, "TaxProfilesPage") },
              { path: "pedidos", element: lazyPage(orders, "OrdersPage") },
              { path: "pedidos/:orderId", element: lazyPage(orderDetail, "OrderDetailPage") },
              { path: "seguridad", element: lazyPage(security, "SecurityPage") },
            ],
          },
        ],
      },
      // Tienda: cada pantalla va en su propio chunk (la portada, que es la entrada, no).
      { path: "tienda", element: lazyPage(listing, "ShopPage") },
      { path: "buscar", element: lazyPage(listing, "SearchPage") },
      { path: "categoria/:slug", element: lazyPage(listing, "CategoryPage") },
      { path: "coleccion/:slug", element: lazyPage(listing, "CollectionPage") },
      {
        path: "producto/:slug",
        element: lazyPage(() => import("@/features/storefront/product/ProductPage"), "ProductPage"),
      },
      // La bolsa de la cabecera enlaza aquí.
      { path: "carrito", element: lazyPage(cartPage, "CartPage") },
      // Pago (S10): detrás de la sesión (toda compra requiere cuenta). «Pagar» manda aquí con sesión y a /login sin ella.
      {
        element: <RequireAuth />,
        children: [
          { path: "checkout", element: lazyPage(checkoutPage, "CheckoutPage") },
          { path: "pedido/:numero", element: lazyPage(confirmationPage, "OrderConfirmationPage") },
        ],
      },
      // Enlaces del pie del diseño: pantallas provisionales hasta que lleguen sus contenidos (nosotros/contacto con la
      // diseñadora; legales en S15).
      { path: "nosotros", element: <PlaceholderPage /> },
      { path: "contacto", element: <PlaceholderPage /> },
      { path: "legal/privacidad", element: <PlaceholderPage /> },
      { path: "legal/reembolsos", element: <PlaceholderPage /> },
      { path: "legal/envios", element: <PlaceholderPage /> },
      { path: "legal/terminos", element: <PlaceholderPage /> },
      // Guía de componentes: solo en desarrollo o en el build del E2E (nunca en producción).
      ...(UI_GUIDE_ENABLED
        ? [
            {
              path: "_ui",
              element: lazyPage(() => import("./pages/ui-guide/UiGuidePage"), "UiGuidePage"),
            },
          ]
        : []),
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
            path: "envios",
            element: lazyPage(
              () => import("@/features/admin/shipping/ShippingLayout"),
              "ShippingLayout",
            ),
            children: [
              {
                index: true,
                element: lazyPage(
                  () => import("@/features/admin/shipping/StorePage"),
                  "ShippingStorePage",
                ),
              },
              {
                path: "zonas",
                element: lazyPage(
                  () => import("@/features/admin/shipping/ZonesPage"),
                  "ShippingZonesPage",
                ),
              },
              {
                path: "tarifas",
                element: lazyPage(
                  () => import("@/features/admin/shipping/RatesPage"),
                  "ShippingRatesPage",
                ),
              },
              {
                path: "entregas",
                element: lazyPage(
                  () => import("@/features/admin/shipping/SlotsPage"),
                  "ShippingDeliveryPage",
                ),
              },
              {
                path: "simulador",
                element: lazyPage(
                  () => import("@/features/admin/shipping/SimulatorPage"),
                  "ShippingSimulatorPage",
                ),
              },
            ],
          },
          {
            path: "descuentos",
            element: lazyPage(
              () => import("@/features/admin/discounts/DiscountsLayout"),
              "DiscountsLayout",
            ),
            children: [
              {
                index: true,
                element: lazyPage(
                  () => import("@/features/admin/discounts/DiscountsPage"),
                  "DiscountsPage",
                ),
              },
              {
                path: "redenciones",
                element: lazyPage(
                  () => import("@/features/admin/discounts/RedemptionsPage"),
                  "RedemptionsPage",
                ),
              },
              {
                path: "grupos",
                element: lazyPage(
                  () => import("@/features/admin/discounts/GroupsPage"),
                  "GroupsPage",
                ),
              },
            ],
          },
          {
            path: "pagos",
            element: lazyPage(
              () => import("@/features/admin/payments/PaymentsLayout"),
              "PaymentsLayout",
            ),
            children: [
              {
                index: true,
                element: lazyPage(
                  () => import("@/features/admin/payments/ReviewPage"),
                  "ReviewPage",
                ),
              },
              {
                path: "lista",
                element: lazyPage(
                  () => import("@/features/admin/payments/PaymentsPage"),
                  "PaymentsPage",
                ),
              },
              {
                path: "metodos",
                element: lazyPage(
                  () => import("@/features/admin/payments/MethodsPage"),
                  "MethodsPage",
                ),
              },
            ],
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
