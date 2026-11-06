import { es } from "../es";
import { adminMessages } from "./messages";

/**
 * Llena `es.admin` con los textos del panel. Es un efecto de importación a propósito: lo importa `AdminShell` (la primera
 * pieza del panel que se carga, siempre antes que cualquiera de sus pantallas) y el arranque de las pruebas. Así los ~75 kB
 * de textos del panel viajan en los chunks del panel y no en la entrada pública (a ellos solo llega un administrador).
 * Una clave `admin.*` consultada antes de este import devuelve la propia clave (visible, no un hueco silencioso).
 */
Object.assign(es.admin, adminMessages);
