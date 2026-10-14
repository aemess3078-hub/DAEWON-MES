/**
 * 범용 메모리 fake DB (테스트 전용)
 *
 *  - where 를 실제로 평가한다(AND/OR/NOT, in/notIn/not/gt/gte/lt/lte/equals/startsWith/contains, 중첩 관계 객체).
 *  - 관계는 행에 중첩 객체로 직접 넣어 둔다(예: itemSupplier.supplier, purchaseOrderItem.purchaseOrder).
 *  - purchaseOrder.create 의 items.create 는 purchaseOrderItem 행으로 풀어 넣는다.
 *  - (tenantId, orderNo) unique 위반 시 P2002.
 *  - $transaction: 트랜잭션별 undo 로그 롤백 + 트랜잭션 범위 잠금(mutex) 지원. 동시 요청 인터리빙을 위해 읽기에서 양보한다.
 *    (스냅샷 복원이 아니라 이 트랜잭션이 만든/바꾼 행만 되돌리므로, 다른 트랜잭션이 커밋한 행을 지우지 않는다.)
 *  - create / createMany 는 uniques(테이블별 unique 키 조합)를 검사해 P2002 를 던진다(NULL 값이 있는 조합은 제외 = PostgreSQL 동작).
 *  - count / skip / take 지원.
 *  - reads / writes 를 기록해 "쿼리 수", "DB write 0건" 을 검증한다.
 */

export type Row = Record<string, any>

const OPS = ["in", "notIn", "not", "gt", "gte", "lt", "lte", "equals", "startsWith", "contains", "mode"]

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const keys = Object.keys(cond as object)
    if (keys.length > 0 && keys.every((k) => OPS.includes(k))) {
      const c = cond as Record<string, any>
      return keys.every((k) => {
        const a = actual as any
        const v = c[k]
        switch (k) {
          case "in":
            return (v as unknown[]).includes(actual)
          case "notIn":
            return !(v as unknown[]).includes(actual)
          case "not":
            return a !== v
          case "equals":
            return a === v
          case "gt":
            return a > v
          case "gte":
            return a >= v
          case "lt":
            return a < v
          case "lte":
            return a <= v
          case "startsWith":
            return typeof a === "string" && a.startsWith(v)
          case "contains":
            return typeof a === "string" && a.includes(v)
          default:
            return true
        }
      })
    }
    if (actual === null || actual === undefined) return false
    return matches(actual as Row, cond as Row)
  }
  return actual === cond
}

export function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((c) => matches(row, c))
    if (k === "AND") return (cond as Row[]).every((c) => matches(row, c))
    if (k === "NOT") return !matches(row, cond as Row)
    return matchValue(row[k], cond)
  })
}

function pick(row: Row, path: Row): unknown {
  const [k, v] = Object.entries(path)[0]
  const inner = row[k]
  return typeof v === "object" && v !== null ? pick((inner ?? {}) as Row, v as Row) : inner
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows
  const orders: Row[] = Array.isArray(orderBy) ? orderBy : [orderBy]
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      // { field: "asc" } 또는 중첩 { relation: { field: "asc" } }
      const dir = (function find(x: any): string {
        const v = Object.values(x)[0] as any
        return typeof v === "string" ? v : find(v)
      })(o)
      const va = pick(a, o) as any
      const vb = pick(b, o) as any
      if (va === vb) continue
      const cmp = va > vb ? 1 : -1
      return dir === "desc" ? -cmp : cmp
    }
    return 0
  })
}

class Mutex {
  private chains = new Map<string, Promise<void>>()
  async acquire(key: string): Promise<() => void> {
    const prev = this.chains.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((res) => (release = res))
    this.chains.set(key, prev.then(() => next))
    await prev
    return release
  }
}

/** 기본 unique 제약(테이블 → 컬럼 조합 목록). 필요하면 makeFakeDb 두 번째 인자로 추가/덮어쓴다. */
const DEFAULT_UNIQUES: Record<string, string[][]> = {
  purchaseOrder: [["tenantId", "orderNo"]],
  mrpRun: [["tenantId", "requestKey"]],
  mrpRunSuggestion: [["runId", "itemId"]],
  mrpRunPurchase: [["tenantId", "requestKey", "supplierId"], ["purchaseOrderId"]],
}

export function makeFakeDb(seed: Record<string, Row[]>, options?: { uniques?: Record<string, string[][]> }) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  for (const k of ["auditLog", "purchaseOrder", "purchaseOrderItem", "mrpRun", "mrpRunSuggestion", "mrpRunPurchase"]) tables[k] = tables[k] ?? []
  const uniques: Record<string, string[][]> = { ...DEFAULT_UNIQUES, ...(options?.uniques ?? {}) }
  type Undo = Array<() => void>
  const checkUnique = (name: string, row: Row) => {
    for (const cols of uniques[name] ?? []) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue
      if (tables[name].some((r) => cols.every((c) => r[c] === row[c]))) {
        throw Object.assign(new Error(`Unique constraint failed on (${cols.join(", ")})`), { code: "P2002" })
      }
    }
  }
  const reads: Array<{ model: string; op: string; where: Row }> = []
  const writes: Array<{ model: string; op: string; data?: Row }> = []
  const failNext = { auditLogAfter: -1 as number } // N번째(0부터) auditLog.create 에서 실패
  let auditCount = 0
  let seq = 1
  const mutex = new Mutex()
  const knownModels = () => Object.keys(tables)

  const yieldTurn = () => new Promise<void>((r) => setImmediate(r))

  const model = (name: string, undo?: Undo) => ({
    count: async (args?: { where?: Row }) => {
      reads.push({ model: name, op: "count", where: args?.where ?? {} })
      const n = tables[name].filter((r) => (args?.where ? matches(r, args.where) : true)).length
      await yieldTurn()
      return n
    },
    findMany: async (args?: { where?: Row; orderBy?: any; take?: number; skip?: number }) => {
      reads.push({ model: name, op: "findMany", where: args?.where ?? {} })
      // 읽기 시점의 스냅샷을 먼저 만들고 양보한다(다른 트랜잭션이 끼어들어도 읽은 값은 그대로 = 커밋 전 읽기)
      let rows = tables[name].filter((r) => (args?.where ? matches(r, args.where) : true))
      rows = sortRows(rows, args?.orderBy)
      if (args?.skip !== undefined) rows = rows.slice(args.skip)
      if (args?.take !== undefined) rows = rows.slice(0, args.take)
      const snapshot = rows.map((r) => ({ ...r }))
      await yieldTurn()
      return snapshot
    },
    findFirst: async (args?: { where?: Row; orderBy?: any }) => {
      reads.push({ model: name, op: "findFirst", where: args?.where ?? {} })
      const rows = sortRows(tables[name].filter((r) => (args?.where ? matches(r, args.where) : true)), args?.orderBy)
      const first = rows[0] ? { ...rows[0] } : null
      await yieldTurn()
      return first
    },
    create: async (args: { data: Row }) => {
      writes.push({ model: name, op: "create", data: args.data })
      if (name === "auditLog") {
        const n = auditCount++
        if (failNext.auditLogAfter === n) throw new Error("audit failure")
      }
      const { items, ...rest } = args.data as Row
      const row: Row = { id: `${name}-${seq++}`, createdAt: new Date("2026-10-01T00:00:00Z"), ...rest }
      checkUnique(name, row)
      if (name === "purchaseOrder") {
        row.supplier = tables.businessPartner?.find((b) => b.id === row.supplierId) ?? { id: row.supplierId, name: "" }
      }
      tables[name].push(row)
      undo?.push(() => {
        const i = tables[name].indexOf(row)
        if (i >= 0) tables[name].splice(i, 1)
      })
      if (name === "purchaseOrder" && items?.create) {
        for (const it of items.create as Row[]) {
          const itemRow: Row = {
            id: `purchaseOrderItem-${seq++}`,
            purchaseOrderId: row.id,
            receivedQty: 0,
            workOrderOperationId: null,
            ...it,
            item: { tenantId: row.tenantId },
            purchaseOrder: row,
          }
          tables.purchaseOrderItem.push(itemRow)
          undo?.push(() => {
            const i = tables.purchaseOrderItem.indexOf(itemRow)
            if (i >= 0) tables.purchaseOrderItem.splice(i, 1)
          })
        }
      }
      return { ...row }
    },
    createMany: async (args: { data: Row[] }) => {
      writes.push({ model: name, op: "createMany" })
      for (const d of args.data) {
        const row: Row = { id: `${name}-${seq++}`, createdAt: new Date("2026-10-01T00:00:00Z"), ...d }
        checkUnique(name, row)
        tables[name].push(row)
        undo?.push(() => {
          const i = tables[name].indexOf(row)
          if (i >= 0) tables[name].splice(i, 1)
        })
      }
      return { count: args.data.length }
    },
    updateMany: async (args: { where: Row; data: Row }) => {
      writes.push({ model: name, op: "updateMany", data: args.data })
      const targets = tables[name].filter((r) => matches(r, args.where))
      targets.forEach((t) => {
        const prev = { ...t }
        Object.assign(t, args.data)
        undo?.push(() => {
          Object.keys(t).forEach((k) => delete t[k])
          Object.assign(t, prev)
        })
      })
      return { count: targets.length }
    },
  })

  const db: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "$transaction") return transaction
        if (prop === "$queryRaw") return async () => []
        if (prop === "__tables") return tables
        if (!knownModels().includes(prop)) throw new Error(`unexpected model access: ${prop}`)
        return model(prop)
      },
    }
  )

  async function transaction(cb: (tx: any) => Promise<unknown>, _options?: unknown) {
    void _options
    const undo: Undo = []
    const releases: Array<() => void> = []
    const tx: any = new Proxy(db, {
      get(target, prop: string) {
        if (prop === "__locks") return releases
        if (typeof prop === "string" && knownModels().includes(prop)) return model(prop, undo)
        return (target as any)[prop]
      },
    })
    try {
      return await cb(tx)
    } catch (e) {
      // 이 트랜잭션이 만든/바꾼 행만 역순으로 되돌린다(다른 트랜잭션의 커밋은 보존)
      for (let i = undo.length - 1; i >= 0; i--) undo[i]()
      throw e
    } finally {
      releases.forEach((r) => r())
    }
  }

  /** 트랜잭션 범위 잠금(fake). 트랜잭션이 끝나면 자동 해제된다. */
  const lock = async (tx: any, key: string) => {
    const release = await mutex.acquire(key)
    ;(tx.__locks as Array<() => void>).push(release)
  }
  const noLock = async () => {}

  return {
    db,
    tables,
    reads,
    writes,
    failNext,
    lock,
    noLock,
    countWrites: (name?: string) => writes.filter((w) => !name || w.model === name).length,
    resetStats() {
      reads.length = 0
      writes.length = 0
    },
  }
}
