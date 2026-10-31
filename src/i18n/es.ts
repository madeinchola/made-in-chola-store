import { adminCommon } from "./admin/common";
import { adminProducts } from "./admin/products";
import { adminTaxonomy } from "./admin/taxonomy";
import { adminConfig } from "./admin/config";
import { adminAudit } from "./admin/audit";
import { ui } from "./ui";
import { store } from "./store";
import { layout } from "./layout";

export const es = {
  app: { name: "Made In Chola" },
  nav: {
    home: "Inicio",
    login: "Ingresar",
    register: "Crear cuenta",
    logout: "Cerrar sesión",
    admin: "Panel",
    account: "Mi cuenta",
  },
  home: {
    eyebrow: "Próximamente",
    title: "Made In Chola",
    subtitle: "Estamos preparando la tienda. Muy pronto vas a poder comprar aquí.",
  },
  notFound: {
    title: "Página no encontrada",
    body: "La página que buscas no existe o fue movida.",
    back: "Volver al inicio",
  },
  auth: {
    login: {
      title: "Acceso",
      identifier: "Email o teléfono",
      identifierHint: "Con el que te registraste",
      password: "Contraseña",
      submit: "Ingresar",
      submitting: "Ingresando…",
      forgot: "¿Olvidaste tu contraseña?",
      noAccount: "¿Aún no tienes cuenta?",
      register: "Crear cuenta",
    },
    register: {
      title: "Crear cuenta",
      name: "Nombre completo",
      viaEmail: "Con email",
      viaPhone: "Con teléfono",
      email: "Email",
      phone: "Teléfono",
      country: "País",
      password: "Contraseña",
      confirm: "Repite la contraseña",
      submit: "Crear cuenta",
      submitting: "Creando cuenta…",
      haveAccount: "¿Ya tienes cuenta?",
      login: "Ingresar",
      show: "Mostrar contraseña",
      hide: "Ocultar contraseña",
    },
    forgot: {
      title: "Recuperar contraseña",
      body: "Ingresa el email de tu cuenta y te enviaremos un enlace para crear una nueva contraseña.",
      email: "Email",
      submit: "Enviar enlace",
      submitting: "Enviando…",
      sent: "Si existe una cuenta con ese email, te enviamos un enlace. Revisa tu bandeja de entrada y el spam.",
      phoneOnly:
        "¿Te registraste solo con teléfono? No tenemos un correo para enviarte el enlace: escríbenos por WhatsApp y te ayudamos a recuperar el acceso.",
      back: "Volver a ingresar",
    },
    reset: {
      title: "Nueva contraseña",
      password: "Nueva contraseña",
      confirm: "Repite la nueva contraseña",
      submit: "Guardar contraseña",
      submitting: "Guardando…",
      success: "Contraseña actualizada.",
      invalidLink: "El enlace no es válido o ya venció. Solicita uno nuevo.",
      checking: "Verificando enlace…",
      requestNew: "Solicitar un enlace nuevo",
    },
    session: { expired: "Tu sesión terminó. Ingresa de nuevo para continuar." },
    errors: {
      invalid_credentials: "Email, teléfono o contraseña incorrectos.",
      rate_limited: "Demasiados intentos. Espera {seconds} segundos e inténtalo de nuevo.",
      register_failed:
        "No pudimos crear la cuenta con esos datos. Si ya tienes una, inicia sesión o recupera tu contraseña.",
      pwned_password: "Esa contraseña apareció en filtraciones públicas. Elige otra.",
      weak_password: "La contraseña no cumple los requisitos.",
      invalid_email: "El email no es válido.",
      invalid_phone: "El teléfono no es válido.",
      identifier_required: "Ingresa un email o un teléfono.",
      network: "No pudimos conectar con el servidor. Revisa tu conexión.",
      unknown: "Ocurrió un error inesperado. Inténtalo de nuevo.",
      required: "Este campo es obligatorio.",
      passwordMismatch: "Las contraseñas no coinciden.",
    },
    password: {
      too_short: "Mínimo 8 caracteres.",
      too_long: "Demasiado larga (máximo 72 bytes).",
      common: "Es una contraseña demasiado común.",
      repetitive: "No uses el mismo carácter repetido.",
      sequential: "No uses secuencias como 12345678 o abcdefgh.",
      contains_identifier: "No incluyas tu email o teléfono.",
    },
    phone: {
      empty: "Ingresa tu teléfono.",
      invalid_chars: "El teléfono solo puede tener números, espacios y guiones.",
      invalid_country: "El código de país del teléfono no es válido.",
      too_short: "El teléfono es demasiado corto.",
      too_long: "El teléfono es demasiado largo.",
      invalid_bo_mobile: "Ingresa un celular boliviano de 8 dígitos que empiece en 6 o 7.",
    },
    email: {
      empty: "Ingresa tu email.",
      invalid: "El email no es válido.",
      too_long: "El email es demasiado largo.",
      reserved_domain: "Ese dominio de email no es válido.",
    },
  },
  guard: { loading: "Cargando…" },
  ui,
  store,
  layout,
  admin: {
    ...adminCommon,
    products: adminProducts,
    taxonomy: adminTaxonomy,
    config: adminConfig,
    audit: adminAudit,
  },
  account: { title: "Mi cuenta", name: "Nombre", email: "Email", phone: "Teléfono", none: "—" },
  placeholder: { soon: "Esta sección estará disponible pronto." },
  error: {
    title: "Algo salió mal",
    body: "Ocurrió un error inesperado. Recarga la página para continuar.",
    reload: "Recargar página",
    reference: "Referencia: {id}",
  },
  env: {
    title: "Configuración incompleta",
    body: "La aplicación no puede iniciar porque faltan o son inválidas estas variables de entorno:",
    hint: "Copia .env.example a .env.local y completa los valores.",
  },
  footer: { rights: "© {year} Made In Chola" },
} as const;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof es>;
