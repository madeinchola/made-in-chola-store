import { type ReactNode, useContext } from "react";
import { CartContext } from "./cart-context";
import { CartProvider } from "./CartProvider";

/**
 * Monta el carrito SOLO donde se necesita (las páginas públicas y la cuenta), no en todo el sitio: el panel de
 * administración no lo usa, y con él montado cada carga de `/admin` hacía una lectura de la bolsa que no necesitaba.
 *
 * Si ya hay un carrito más arriba (las pruebas ponen uno con un servidor de mentira) lo reutiliza en vez de crear un
 * segundo: dos almacenes a la vez duplicarían las peticiones y cada uno vería una foto distinta de la misma bolsa.
 */
export function CartScope({ children }: { children: ReactNode }) {
  const existing = useContext(CartContext);
  return existing ? <>{children}</> : <CartProvider>{children}</CartProvider>;
}
