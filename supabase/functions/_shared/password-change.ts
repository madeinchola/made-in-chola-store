import { HttpError } from "./errors.ts";
import { validatePassword } from "./password-policy.ts";
import { checkPasswordPwned } from "./pwned.ts";

/**
 * Política de contraseñas ÚNICA para registro, restablecer y cambiar: longitud, comunes, relación con el contacto y
 * filtraciones públicas. Lanza HttpError 400 con los motivos para que el formulario los muestre.
 */
export async function assertPasswordAcceptable(
  password: string,
  context: { email?: string | null; phone?: string | null },
): Promise<void> {
  const policy = validatePassword(password, {
    email: context.email ?? null,
    phone: context.phone ?? null,
  });
  if (!policy.ok) {
    throw new HttpError(
      400,
      "weak_password",
      "La contraseña no cumple los requisitos",
      {},
      { failures: policy.failures },
    );
  }
  if ((await checkPasswordPwned(password)).pwned) {
    throw new HttpError(
      400,
      "pwned_password",
      "Esa contraseña apareció en filtraciones públicas. Elige otra.",
    );
  }
}
