/**
 * La exportación a CSV es de uso general (S14 la usa en los reportes): vive en `@/lib/csv`. Este archivo conserva el nombre con el
 * que la importan las pantallas de cupones.
 */
export {
  REVOKE_DELAY_MS,
  csvCell,
  csvFileName,
  downloadCsv,
  neutralizeFormula,
  toCsv,
} from "@/lib/csv";
