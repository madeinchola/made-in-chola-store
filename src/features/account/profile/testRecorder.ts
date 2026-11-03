/**
 * Supabase FALSO que GRABA cada llamada encadenada (`from(t).select(..).eq(..)…`) para comprobar qué columnas, filtros y
 * cuerpos se envían de verdad. Solo para tests (no lo importa código de la aplicación).
 */
export type RecordedOp = [name: string, args: unknown[]];
export interface RecordedCall {
  table: string;
  ops: RecordedOp[];
}
export interface Reply {
  data: unknown;
  error: { code?: string; message: string } | null;
}

export function createRecorder(respond: (call: RecordedCall) => Reply) {
  const calls: RecordedCall[] = [];
  const client = {
    from(table: string) {
      const call: RecordedCall = { table, ops: [] };
      calls.push(call);
      const chain: object = new Proxy(
        {},
        {
          get(_target, prop) {
            // `await chain` pide `then`: ahí se entrega la respuesta configurada.
            if (prop === "then") {
              return (resolve: (v: Reply) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(respond(call)).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
  return { client, calls };
}

/** Argumentos de la primera llamada encadenada con ese nombre (o `undefined` si no se hizo). */
export const argsOf = (call: RecordedCall | undefined, name: string): unknown[] | undefined =>
  call?.ops.find(([op]) => op === name)?.[1];

/** Nombres de las operaciones encadenadas, en orden. */
export const opNames = (call: RecordedCall | undefined): string[] =>
  call?.ops.map(([op]) => op) ?? [];
