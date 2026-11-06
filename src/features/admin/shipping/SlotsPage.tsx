import { BlockedDatesSection } from "./BlockedDatesSection";
import { SlotsRulesCard } from "./SlotsRulesCard";
import { SlotsWeekSection } from "./SlotsWeekSection";

/** «Entregas»: reglas del calendario (solo lectura), franjas por día de la semana y fechas bloqueadas. */
export function ShippingDeliveryPage() {
  return (
    <div className="space-y-6">
      <SlotsRulesCard />
      <SlotsWeekSection />
      <BlockedDatesSection />
    </div>
  );
}
