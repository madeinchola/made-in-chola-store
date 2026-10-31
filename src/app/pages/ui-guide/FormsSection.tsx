import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Block } from "./Block";

export function FormsSection() {
  const [terms, setTerms] = useState<boolean | "indeterminate">(false);
  return (
    <Block
      id="formularios"
      title="Formularios"
      note="Cada campo enlaza etiqueta, ayuda y error para lectores de pantalla. El borde de los campos cumple 3:1 de contraste."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Nombre completo" hint="Como aparece en tu documento">
          <Input defaultValue="María Quispe" autoComplete="off" />
        </Field>
        <Field label="Email" error="El email no es válido.">
          <Input defaultValue="maria@" autoComplete="off" />
        </Field>
        <Field label="Contraseña">
          <PasswordInput defaultValue="contraseña-segura" autoComplete="off" />
        </Field>
        <Field label="Ciudad">
          <Select defaultValue="lp">
            <option value="lp">La Paz</option>
            <option value="scz">Santa Cruz de la Sierra</option>
            <option value="cbba">Cochabamba</option>
          </Select>
        </Field>
        <Field label="Campo desactivado">
          <Input disabled defaultValue="No editable" />
        </Field>
        <Field label="Comentarios">
          <Textarea defaultValue="Entregar en la tarde, por favor." />
        </Field>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Casillas</legend>
          <div className="flex items-center gap-2">
            <Checkbox id="g-terms" checked={terms} onCheckedChange={setTerms} />
            <label htmlFor="g-terms" className="text-sm">
              Acepto los términos
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="g-mixed" checked="indeterminate" />
            <label htmlFor="g-mixed" className="text-sm">
              Seleccionar todo (parcial)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="g-dis" disabled />
            <label htmlFor="g-dis" className="text-sm text-muted-foreground">
              Desactivada
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="g-inv" aria-invalid="true" />
            <label htmlFor="g-inv" className="text-sm">
              Con error
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Opciones</legend>
          <RadioGroup defaultValue="env" aria-label="Forma de entrega">
            <div className="flex items-center gap-2">
              <RadioGroupItem id="g-r1" value="env" />
              <label htmlFor="g-r1" className="text-sm">
                Envío a domicilio
              </label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="g-r2" value="rec" />
              <label htmlFor="g-r2" className="text-sm">
                Recojo en tienda
              </label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="g-r3" value="x" disabled />
              <label htmlFor="g-r3" className="text-sm text-muted-foreground">
                No disponible
              </label>
            </div>
          </RadioGroup>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Interruptores</legend>
          <div className="flex items-center gap-3">
            <Switch id="g-s1" defaultChecked />
            <label htmlFor="g-s1" className="text-sm">
              Visible en la tienda
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="g-s2" />
            <label htmlFor="g-s2" className="text-sm">
              Producto nuevo
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="g-s3" disabled />
            <label htmlFor="g-s3" className="text-sm text-muted-foreground">
              Desactivado
            </label>
          </div>
        </fieldset>
      </div>
    </Block>
  );
}
