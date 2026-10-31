/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" incluye la guía de componentes `/_ui` en el build (solo para E2E; nunca en producción). */
  readonly VITE_UI_GUIDE?: string;
}
