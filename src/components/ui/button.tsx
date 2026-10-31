import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Muestra un indicador y anuncia el botón como ocupado (`aria-busy`). Se bloquea con `aria-disabled` y NO con `disabled`:
   * quien pulsa Intro y ve el botón pasar a «cargando» no debe perder el foco; el clic (y el envío implícito del
   * formulario) se ignoran mientras dura.
   */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      caps,
      asChild = false,
      loading = false,
      onClick,
      children,
      ...props
    },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size, caps, className }));
    if (asChild) {
      // Slot exige un único hijo: el indicador de carga no aplica a enlaces.
      return (
        <Slot className={classes} ref={ref} onClick={onClick} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={classes}
        ref={ref}
        {...props}
        {...(loading ? { "aria-disabled": true } : {})}
        aria-busy={loading || undefined}
        onClick={(event) => {
          if (loading) {
            // También frena el envío implícito del formulario (Intro en un campo dispara un clic en el botón de envío).
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button };
