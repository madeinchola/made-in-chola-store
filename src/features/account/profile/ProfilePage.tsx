import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/useAuth";
import { t, type MessageKey } from "@/i18n";
import {
  ContactDialog,
  type ContactKind,
  type ContactMode,
  type ContactTarget,
} from "./ContactDialog";
import { NameDialog } from "./NameDialog";
import { PreferencesForm } from "./PreferencesForm";
import { formatPhoneDisplay } from "./phoneFormat";

interface RowProps {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
}

/** Una fila de la lista de datos: etiqueta, valor y acciones. En móvil se apila; desde `sm` va en columnas. */
function Row({ label, value, children, note }: RowProps) {
  return (
    <div className="grid gap-x-4 gap-y-2 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
      <dd className="flex flex-wrap gap-2">{children}</dd>
      {note && <dd className="text-sm text-muted-foreground sm:col-span-3">{note}</dd>}
    </div>
  );
}

interface ContactRowProps {
  kind: ContactKind;
  /** Valor para mostrar (ya con formato) o null si no hay. */
  display: string | null;
  /** ¿Hay OTRO medio para ingresar? Sin él, quitar este dejaría la cuenta sin acceso. */
  hasOther: boolean;
  onOpen: (mode: ContactMode) => void;
  actionRef: RefObject<HTMLButtonElement>;
}

function ContactRow({ kind, display, hasOther, onOpen, actionRef }: ContactRowProps) {
  const has = display !== null;
  const cap = kind === "email" ? "Email" : "Phone";
  const lastIdentifier = has && !hasOther;
  const noteId = `contact-${kind}-note`;
  return (
    <Row
      label={t(`acct.profile.personal.${kind}`)}
      value={display ?? t("acct.profile.personal.none")}
      note={
        lastIdentifier ? (
          <span id={noteId}>
            {t(
              kind === "email"
                ? "acct.profile.personal.onlyEmail"
                : "acct.profile.personal.onlyPhone",
            )}
          </span>
        ) : undefined
      }
    >
      <Button
        ref={actionRef}
        type="button"
        variant="outline"
        size="sm"
        aria-label={t(`acct.profile.personal.${has ? "change" : "add"}${cap}` as MessageKey)}
        onClick={() => onOpen(has ? "change" : "add")}
      >
        {t(has ? "acct.profile.personal.change" : "acct.profile.personal.add")}
      </Button>
      {has && (
        // `aria-disabled` y no `disabled`: un botón que se deshabilita con el foco lo pierde, y así además se puede
        // leer POR QUÉ no se puede quitar (la nota enlazada).
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t(`acct.profile.personal.remove${cap}` as MessageKey)}
          aria-disabled={lastIdentifier || undefined}
          aria-describedby={lastIdentifier ? noteId : undefined}
          onClick={() => !lastIdentifier && onOpen("remove")}
        >
          {t("acct.profile.personal.remove")}
        </Button>
      )}
    </Row>
  );
}

/**
 * `/cuenta`: nombre, email, teléfono (con contraseña para cambiarlos) y preferencias. PROVISIONAL en estilo (no hay
 * diseño de cuenta). El nombre se muestra en `data-testid="account-name"` (lo usan los tests y el E2E).
 */
export function ProfilePage() {
  const { profile } = useAuth();
  const [nameOpen, setNameOpen] = useState(false);
  const [contact, setContact] = useState<ContactTarget | null>(null);
  const emailAction = useRef<HTMLButtonElement>(null);
  const phoneAction = useRef<HTMLButtonElement>(null);
  const lastKind = useRef<ContactKind>("email");

  const email = profile?.email ?? null;
  const phone = profile?.phone_e164 ?? null;

  const open = (kind: ContactKind) => (mode: ContactMode) => {
    lastKind.current = kind;
    setContact({ kind, mode });
  };

  return (
    <div className="space-y-12">
      <header className="space-y-1">
        <h2 className="font-display text-display-md">{t("acct.profile.title")}</h2>
        <p className="text-muted-foreground">{t("acct.profile.intro")}</p>
      </header>

      <section aria-labelledby="profile-personal" className="space-y-2">
        <h3 id="profile-personal" className="font-display text-display-sm">
          {t("acct.profile.personal.title")}
        </h3>
        <dl className="divide-y divide-border border-y border-border">
          <Row
            label={t("acct.profile.personal.name")}
            value={
              <span data-testid="account-name">
                {profile?.full_name ?? t("acct.profile.personal.none")}
              </span>
            }
          >
            <Button type="button" variant="outline" size="sm" onClick={() => setNameOpen(true)}>
              {t("acct.profile.personal.editName")}
            </Button>
          </Row>
          <ContactRow
            kind="email"
            display={email}
            hasOther={phone !== null}
            onOpen={open("email")}
            actionRef={emailAction}
          />
          <ContactRow
            kind="phone"
            display={phone === null ? null : formatPhoneDisplay(phone)}
            hasOther={email !== null}
            onOpen={open("phone")}
            actionRef={phoneAction}
          />
        </dl>
      </section>

      <PreferencesForm />

      <NameDialog
        open={nameOpen}
        onOpenChange={setNameOpen}
        currentName={profile?.full_name ?? ""}
      />
      <ContactDialog
        target={contact}
        onOpenChange={(next) => !next && setContact(null)}
        currentEmail={email}
        currentPhone={phone}
        onCloseAutoFocus={(event) => {
          // Si quien abrió el diálogo ya no existe (p. ej. «Quitar» desapareció), el foco vuelve al botón principal de la fila.
          if (!event.defaultPrevented) {
            event.preventDefault();
            (lastKind.current === "email" ? emailAction : phoneAction).current?.focus();
          }
        }}
      />
    </div>
  );
}
