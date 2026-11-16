import { adminOrdersDetail } from "./ordersDetail";
import { adminOrdersList } from "./ordersList";
import { adminOrdersManual } from "./ordersManual";
import { adminOrdersErrors } from "./ordersErrors";

/**
 * Panel de Pedidos (Sprint 12): el marco común (título, pestañas, estados y errores); cada pantalla tiene su archivo de textos.
 * Los importes y los estados los calcula la base; aquí solo se explican.
 */
export const adminOrders = {
  title: "Pedidos",
  description:
    "Atiende el día a día: avanza pedidos, edítalos, créalos a mano, cancela y reembolsa, y sigue las incidencias. Todo lo que haces queda en la auditoría.",
  newOrder: "Nuevo pedido",
  attentionBadge: "{count} pedidos piden atención",
  tabs: {
    label: "Secciones de Pedidos",
    list: "Pedidos",
    attention: "Atención requerida",
    incidents: "Incidencias",
    blacklist: "Lista negra",
  },
  status: {
    pending_payment: "Pendiente de pago",
    paid: "Pagado",
    preparing: "En preparación",
    shipped: "Enviado",
    delivered: "Entregado",
    completed: "Completado",
    cancelled: "Cancelado",
    refunded: "Reembolsado",
  },
  channel: { web: "Tienda", manual: "Manual", whatsapp: "WhatsApp (manual)" },
  advance: {
    pending_payment: "Confirmar pago",
    paid: "Pasar a preparación",
    preparing: "Marcar enviado",
    shipped: "Marcar entregado",
    delivered: "Completar pedido",
  },
  advanceDialog: {
    effect: {
      pending_payment:
        "Confirma que ya recibiste el pago. El pedido pasa a «pagado» y se le avisa a la clienta.",
      paid: "El pedido pasa a «en preparación»: la clienta ya no puede cancelarlo por su cuenta.",
      preparing: "El pedido pasa a «enviado» y se le avisa a la clienta.",
      shipped: "El pedido pasa a «entregado» y se le avisa a la clienta.",
      delivered: "El pedido pasa a «completado». Es el último paso del flujo.",
    },
    reason: "Nota (opcional)",
    reasonTooLong: "La nota admite hasta 300 caracteres.",
    confirm: "Confirmar",
    working: "Guardando…",
    done: "Pedido {number}: ahora está «{status}».",
  },
  csv: {
    number: "Número",
    date: "Fecha",
    status: "Estado",
    client: "Cliente",
    phone: "Teléfono",
    method: "Método de pago",
    channel: "Canal",
    total: "Total",
    currency: "Moneda",
  },
  errors: adminOrdersErrors,
  list: adminOrdersList,
  ...adminOrdersDetail,
  manual: adminOrdersManual,
} as const;
