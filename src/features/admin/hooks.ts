import { useEffect, useState } from "react";

/** Devuelve `value` tras `delayMs` sin cambios: evita una consulta por cada tecla en los buscadores. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
