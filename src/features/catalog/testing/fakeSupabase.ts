/**
 * Supabase FALSO en memoria para tests unitarios. A diferencia de un mock que solo verifica llamadas, este
 * filtra, ordena y pagina de verdad (el subconjunto de PostgREST que usa el catálogo), de modo que los tests
 * comprueban el COMPORTAMIENTO observable. Los permisos/RLS reales se prueban en SQL y en integración.
 */
type Row = Record<string, unknown>;
interface DbError {
  code?: string;
  message: string;
}
interface Result {
  data: unknown;
  error: DbError | null;
  count?: number | null;
}

export interface FakeConfig {
  tables: Record<string, Row[]>;
  rpc?: Record<string, (args: Record<string, unknown>) => unknown>;
  /** Fuerza un error para una tabla o función. */
  errors?: Record<string, DbError>;
}

export interface FakeCall {
  kind: "from" | "rpc";
  name: string;
  filters: string[];
  args?: Record<string, unknown>;
}

const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // nulls al final (como Postgres en ASC)
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es");
};

export function createFakeSupabase(config: FakeConfig) {
  const calls: FakeCall[] = [];

  class Query implements PromiseLike<Result> {
    private rows: Row[];
    private orders: { column: string; ascending: boolean }[] = [];
    private rangeSpec: [number, number] | null = null;
    private limitN: number | null = null;
    private wantCount = false;
    private readonly call: FakeCall;

    constructor(private readonly table: string) {
      this.rows = [...(config.tables[table] ?? [])];
      this.call = { kind: "from", name: table, filters: [] };
      calls.push(this.call);
    }

    select(_columns?: string, options?: { count?: string }) {
      this.wantCount = options?.count === "exact";
      return this;
    }
    eq(column: string, value: unknown) {
      this.call.filters.push(`eq:${column}=${String(value)}`);
      this.rows = this.rows.filter((r) => r[column] === value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.call.filters.push(`in:${column}[${values.length}]`);
      this.rows = this.rows.filter((r) => values.includes(r[column]));
      return this;
    }
    is(column: string, value: null) {
      this.call.filters.push(`is:${column}`);
      this.rows = this.rows.filter((r) => (r[column] ?? null) === value);
      return this;
    }
    order(column: string, options?: { ascending?: boolean }) {
      this.orders.push({ column, ascending: options?.ascending ?? true });
      return this;
    }
    range(from: number, to: number) {
      this.rangeSpec = [from, to];
      return this;
    }
    limit(n: number) {
      this.limitN = n;
      return this;
    }

    private run(): Result {
      const forced = config.errors?.[this.table];
      if (forced) return { data: null, error: forced };
      let rows = [...this.rows];
      rows.sort((a, b) => {
        for (const o of this.orders) {
          const c = compare(a[o.column], b[o.column]);
          if (c !== 0) return o.ascending ? c : -c;
        }
        return 0;
      });
      const total = rows.length;
      if (this.rangeSpec) rows = rows.slice(this.rangeSpec[0], this.rangeSpec[1] + 1);
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      return { data: rows, error: null, count: this.wantCount ? total : null };
    }

    async maybeSingle(): Promise<Result> {
      const r = this.run();
      if (r.error) return r;
      const rows = r.data as Row[];
      if (rows.length > 1) {
        return {
          data: null,
          error: { code: "PGRST116", message: "JSON object requested, multiple rows returned" },
        };
      }
      return { data: rows[0] ?? null, error: null };
    }

    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }

  const client = {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
      calls.push({ kind: "rpc", name, filters: [], args });
      const forced = config.errors?.[name];
      if (forced) return { data: null, error: forced };
      const handler = config.rpc?.[name];
      if (!handler)
        return {
          data: null,
          error: { code: "PGRST202", message: `función ${name} no encontrada` },
        };
      return { data: handler(args), error: null };
    },
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `http://fake.local/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  };

  return { client, calls };
}
