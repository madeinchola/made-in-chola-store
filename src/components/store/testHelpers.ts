import type { UserEvent } from "@testing-library/user-event";

/**
 * Pulsa una flecha como lo hace un teclado real. Radix selecciona la opción al ENFOCARLA solo si la flecha sigue pulsada
 * en ese momento (y mueve el foco en un `setTimeout`), pero `user.keyboard("{ArrowRight}")` suelta la tecla al instante.
 * Se mantiene pulsada un instante y se suelta después.
 */
export async function pressArrow(user: UserEvent, key: "ArrowLeft" | "ArrowRight") {
  await user.keyboard(`{${key}>}`);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await user.keyboard(`{/${key}}`);
}
