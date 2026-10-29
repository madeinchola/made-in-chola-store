export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Respuesta de error uniforme; los errores inesperados no filtran detalles internos. */
export function errorResponse(
  error: unknown,
  correlationId: string,
  headers: Record<string, string> = {},
): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message, correlationId, ...error.details } },
      error.status,
      { ...headers, ...error.headers },
    );
  }
  return jsonResponse(
    { error: { code: "internal", message: "Error interno", correlationId } },
    500,
    headers,
  );
}
