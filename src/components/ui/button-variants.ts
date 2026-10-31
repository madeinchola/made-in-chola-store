import { cva } from "class-variance-authority";

/** Estilos del botón (también para enlaces con aspecto de botón: `<Link className={buttonVariants({...})}>`). */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-medium transition-colors duration-fast ease-standard disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-disabled:pointer-events-none aria-disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        outline:
          "border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground",
        ghost: "hover:bg-muted",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "rounded-sm text-foreground underline underline-offset-4 hover:text-muted-foreground",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10 shrink-0",
      },
      /** Estilo de la tienda: mayúsculas con espaciado, como en el diseño. El panel usa texto normal. */
      caps: { true: "eyebrow text-xs", false: "" },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0 py-0" }],
    defaultVariants: { variant: "default", size: "default", caps: false },
  },
);
