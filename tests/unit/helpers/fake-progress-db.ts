export type FakeDocData = Record<string, unknown>;

export interface FakeDocRef {
  id: string;
  collectionName: string;
  path: string;
  set(data: FakeDocData): Promise<void>;
}

interface Filter {
  field: string;
  value: unknown;
}

export interface FakeQuery {
  collectionName: string;
  filters: Filter[];
  where(field: string, op: '==', value: unknown): FakeQuery;
  get(): Promise<FakeQuerySnapshot>;
}

export interface FakeDocSnapshot {
  id: string;
  ref: FakeDocRef;
  exists: boolean;
  data(): FakeDocData | undefined;
}

export interface FakeQuerySnapshot {
  docs: FakeDocSnapshot[];
}

export interface FakeTransaction {
  getAll(...refs: FakeDocRef[]): Promise<FakeDocSnapshot[]>;
  get(query: FakeQuery): Promise<FakeQuerySnapshot>;
  set(ref: FakeDocRef, data: FakeDocData): void;
  update(ref: FakeDocRef, data: FakeDocData): void;
}

export interface FakeWrite {
  operation: 'set' | 'update';
  ref: FakeDocRef;
  data: FakeDocData;
}

/** Small observable Firestore boundary with serialized transactions for route contract tests. */
export class FakeProgressDb {
  private documents = new Map<string, FakeDocData>();
  private autoId = 0;
  private transactionQueue: Promise<unknown> = Promise.resolve();
  readonly writes: FakeWrite[] = [];

  ref(collectionName: string, id: string): FakeDocRef {
    const ref: FakeDocRef = {
      id,
      collectionName,
      path: `${collectionName}/${id}`,
      set: async (data) => {
        this.documents.set(ref.path, data);
        this.writes.push({ operation: 'set', ref, data });
      },
    };
    return ref;
  }

  seed(collectionName: string, id: string, data: FakeDocData): FakeDocRef {
    const ref = this.ref(collectionName, id);
    this.documents.set(ref.path, data);
    return ref;
  }

  get(collectionName: string, id: string): FakeDocData | undefined {
    return this.documents.get(`${collectionName}/${id}`);
  }

  all(collectionName: string): FakeDocData[] {
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(`${collectionName}/`))
      .map(([, data]) => data);
  }

  collection(collectionName: string) {
    return {
      doc: (id?: string) => this.ref(collectionName, id ?? `${collectionName}-generated-${++this.autoId}`),
      where: (field: string, op: '==', value: unknown) => this.query(collectionName, [{ field, value }]),
    };
  }

  query(collectionName: string, filters: Filter[]): FakeQuery {
    return {
      collectionName,
      filters,
      where: (field: string, op: '==', value: unknown) => this.query(collectionName, [...filters, { field, value }]),
      get: () => this.getQuery(collectionName, filters),
    };
  }

  private snapshot(ref: FakeDocRef): FakeDocSnapshot {
    const data = this.documents.get(ref.path);
    return {
      id: ref.id,
      ref,
      exists: data !== undefined,
      data: () => data,
    };
  }

  private async getQuery(collectionName: string, filters: Filter[]): Promise<FakeQuerySnapshot> {
    const docs = [...this.documents.entries()]
      .filter(([path, data]) => path.startsWith(`${collectionName}/`) && filters.every((filter) => data[filter.field] === filter.value))
      .map(([path]) => this.snapshot(this.ref(collectionName, path.slice(collectionName.length + 1))));
    return { docs };
  }

  async runTransaction<T>(callback: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const run = this.transactionQueue.then(async () => {
      const pending: FakeWrite[] = [];
      const tx: FakeTransaction = {
        getAll: async (...refs) => refs.map((ref) => this.snapshot(ref)),
        get: async (query) => this.getQuery(query.collectionName, query.filters),
        set: (ref, data) => pending.push({ operation: 'set', ref, data }),
        update: (ref, data) => pending.push({ operation: 'update', ref, data }),
      };
      const result = await callback(tx);
      for (const write of pending) {
        const current = this.documents.get(write.ref.path) ?? {};
        this.documents.set(write.ref.path, write.operation === 'set' ? write.data : { ...current, ...write.data });
        this.writes.push(write);
      }
      return result;
    });
    this.transactionQueue = run.catch(() => undefined);
    return run;
  }
}
