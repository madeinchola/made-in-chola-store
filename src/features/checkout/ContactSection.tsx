import { forwardRef } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { ContactErrors, ContactField, ContactForm } from "./checkoutForm";

export type ContactRefs = Record<ContactField, React.RefObject<HTMLInputElement>>;

/** «Contacto»: nombre, correo (opcional) y teléfono, precargados desde el perfil. Solo viajan al pedido (no cambian el perfil). */
export const ContactSection = forwardRef<
  HTMLHeadingElement,
  {
    values: ContactForm;
    errors: ContactErrors;
    refs: ContactRefs;
    onChange: (field: ContactField, value: string) => void;
  }
>(function ContactSection({ values, errors, refs, onChange }, headingRef) {
  return (
    <section aria-labelledby="checkout-contact" className="space-y-4">
      <h2
        id="checkout-contact"
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-display-sm"
      >
        {t("checkout.contact.title")}
      </h2>
      <Field label={t("checkout.contact.name")} error={errors.name}>
        <Input
          ref={refs.name}
          value={values.name}
          autoComplete="name"
          maxLength={120}
          onChange={(event) => onChange("name", event.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("checkout.contact.email")}
          hint={t("checkout.contact.emailHint")}
          error={errors.email}
        >
          <Input
            ref={refs.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            maxLength={254}
            onChange={(event) => onChange("email", event.target.value)}
          />
        </Field>
        <Field
          label={t("checkout.contact.phone")}
          hint={t("checkout.contact.phoneHint")}
          error={errors.phone}
        >
          <Input
            ref={refs.phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={values.phone}
            maxLength={24}
            onChange={(event) => onChange("phone", event.target.value)}
          />
        </Field>
      </div>
    </section>
  );
});
