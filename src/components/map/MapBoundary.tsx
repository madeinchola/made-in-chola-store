import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "@/lib/logger";

interface Props {
  /** Qué pintar si el mapa no se pudo cargar (sin conexión, chunk caído…). */
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * Aísla un fallo del mapa (por ejemplo, el chunk de Leaflet que no descarga sin conexión) para que NO se lleve por delante
 * el formulario que lo contiene: el mapa es opcional, lo que la persona ya escribió debe sobrevivir.
 * Para reintentar basta con cambiar su `key` desde fuera.
 */
export class MapBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    logger.warn("No se pudo cargar el mapa", {
      error: error instanceof Error ? error.name : "desconocido",
      componentStack: info.componentStack,
    });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
