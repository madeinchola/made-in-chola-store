/**
 * La guía de componentes (`/_ui`) solo existe en desarrollo o si el build se hizo con `VITE_UI_GUIDE=true`
 * (lo hace el E2E). El build de producción NO la incluye: es una herramienta interna, no una página pública.
 */
export const UI_GUIDE_ENABLED = import.meta.env.DEV || import.meta.env.VITE_UI_GUIDE === "true";
