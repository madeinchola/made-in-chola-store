import { StoreLocationsSection } from "./StoreLocationsSection";
import { StoreMethodsSection } from "./StoreMethodsSection";

/**
 * Tienda y métodos (pestaña del panel de Envíos): dónde están las ubicaciones de la tienda (con el origen del cálculo de
 * distancia) y qué métodos de envío se ofrecen. Se pinta dentro del marco de `ShippingLayout` (que ya pone el <h1>).
 */
export function ShippingStorePage() {
  return (
    <div className="space-y-6">
      <StoreLocationsSection />
      <StoreMethodsSection />
    </div>
  );
}
