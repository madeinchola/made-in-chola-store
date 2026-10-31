import { Toaster as Sonner } from "sonner";
import { t } from "@/i18n";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Notificaciones (sonner) con los tokens del diseño. El texto de cada tipo se mantiene AA sobre su fondo suave. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-center"
      containerAriaLabel={t("ui.toast.label")}
      toastOptions={{
        classNames: {
          toast:
            "group !rounded-card !border-border !bg-card !font-sans !text-card-foreground !shadow-md",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-muted !text-foreground",
          success: "!border-success/40 !bg-success-soft !text-success",
          warning: "!border-warning/40 !bg-warning-soft !text-warning",
          error: "!border-destructive/40 !bg-destructive-soft !text-destructive",
          info: "!border-info/40 !bg-info-soft !text-info",
        },
      }}
      {...props}
    />
  );
}
