import { type ComponentProps, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useRescueFocus } from "./focus";

/** Botón que, si desaparece teniendo el foco, lo deja en un sitio razonable (ver `useRescueFocus`). */
export function RescueButton(props: ComponentProps<typeof Button>) {
  const ref = useRef<HTMLButtonElement>(null);
  useRescueFocus(ref);
  return <Button ref={ref} {...props} />;
}
