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
const notificationPreferences = () =>
  import("@/features/account/notifications/NotificationPreferencesPage");
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
              {
                path: "notificaciones",
                element: lazyPage(notificationPreferences, "NotificationPreferencesPage"),
              },
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
            path: "pedidos",
            children: [
              {
                // El marco con pestañas envuelve la bandeja, «atención», incidencias y lista negra.
                element: lazyPage(
                  () => import("@/features/admin/orders/OrdersLayout"),
                  "OrdersLayout",
                ),
                children: [
                  {
                    index: true,
                    element: lazyPage(
                      () => import("@/features/admin/orders/OrdersPage"),
                      "OrdersPage",
                    ),
                  },
                  {
                    path: "atencion",
                    element: lazyPage(
                      () => import("@/features/admin/orders/AttentionPage"),
                      "AttentionPage",
                    ),
                  },
                  {
                    path: "incidencias",
                    element: lazyPage(
                      () => import("@/features/admin/orders/IncidentsPage"),
                      "IncidentsPage",
                    ),
                  },
                  {
                    path: "lista-negra",
                    element: lazyPage(
                      () => import("@/features/admin/orders/BlacklistPage"),
                      "BlacklistPage",
                    ),
                  },
                ],
              },
              {
                path: "nuevo",
                element: lazyPage(
                  () => import("@/features/admin/orders/ManualOrderPage"),
                  "ManualOrderPage",
                ),
              },
              {
                path: "imprimir",
                element: lazyPage(
                  () => import("@/features/admin/analytics/print/PrintPage"),
                  "PrintPage",
                ),
              },
              {
                path: ":id",
                element: lazyPage(
                  () => import("@/features/admin/orders/OrderDetailPage"),
                  "OrderDetailPage",
                ),
              },
            ],
          },
          {
            path: "notificaciones",
            // El marco con pestañas envuelve el registro, las plantillas y los ajustes del envío.
            element: lazyPage(
              () => import("@/features/admin/notifications/NotificationsLayout"),
              "NotificationsLayout",
            ),
            children: [
              {
                index: true,
                element: lazyPage(
                  () => import("@/features/admin/notifications/LogPage"),
                  "LogPage",
                ),
              },
              {
                path: "plantillas",
                element: lazyPage(
                  () => import("@/features/admin/notifications/TemplatesPage"),
                  "TemplatesPage",
                ),
              },
              {
                path: "envio",
                element: lazyPage(
                  () => import("@/features/admin/notifications/SettingsPage"),
                  "SettingsPage",
                ),
              },
            ],
          },
          {
            path: "reportes",
            // El marco con pestañas envuelve cada reporte (ventas, productos, inventario, descuentos, pagos, devoluciones, clientas).
            element: lazyPage(
              () => import("@/features/admin/analytics/ReportsLayout"),
              "ReportsLayout",
            ),
            children: [
              {
                index: true,
                element: lazyPage(
                  () => import("@/features/admin/analytics/ReportPage"),
                  "SalesReport",
                ),
              },
              {
                path: "productos",
                element: lazyPage(
                  () => import("@/features/admin/analytics/ReportPage"),
                  "ProductsReport",
                ),
              },
              {
                path: "inventario",
                element: lazyPage(
                  () => import("@/features/admin/analytics/ReportPage"),
                  "InventoryReport",
                ),
              },
              {
                path: "descuentos",
                element: lazyPage(
                  () => import("@/features/admin/analytics/ReportPage"),
                  "DiscountsReport",
                ),
              },
              {
                path: "pagos",
                element: lazyPage(
                  () => import("@/features/admin/analytics/ReportPage"),
                  "PaymentsReport",
                ),
              },
              {
                path: "devoluciones",
                element: lazyPage(
                  () => import("@/features/admin/analytics/ReportPage"),
                  "ReturnsReport",
                ),
              },
              {
                path: "clientas",
                element: lazyPage(
                  () => import("@/features/admin/analytics/ReportPage"),
                  "CustomersReport",
                ),
              },
            ],
          },
          {
            path: "importar",
            element: lazyPage(
              () => import("@/features/admin/analytics/import/ImportPage"),
              "ImportPage",
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
