import "@testing-library/jest-dom/vitest";
import "@/i18n/admin/register"; // los textos del panel se registran al cargar el panel; las pruebas los tienen siempre
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Un aviso de React por HTML inválido (p. ej. <li> dentro de <li>) o por claves repetidas es un defecto real que
// jsdom no hace fallar por sí solo: aquí rompe la prueba que lo provoca.
const reactDefects: string[] = [];
/* eslint-disable no-console -- este archivo ES el guardián de la consola de las pruebas */
const reportError = console.error;
console.error = (...args: unknown[]) => {
  const text = args.map(String).join(" ");
  if (/validateDOMNesting|unique "key" prop/.test(text))
    reactDefects.push(text.split("\n")[0] ?? text);
  reportError(...args);
};
/* eslint-enable no-console */
beforeEach(() => {
  reactDefects.length = 0;
});

afterEach(() => {
  cleanup();
  if (reactDefects.length > 0) {
    throw new Error(`React avisó de un defecto de marcado: ${reactDefects.join(" | ")}`);
  }
});

// jsdom no implementa estas APIs de navegador que usan Radix, embla y los componentes de la tienda.
if (typeof window !== "undefined") {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}
