/**
 * 품목 마스터(Item/BusinessPartner/ItemSupplier/ItemPrice/AuditLog)용 메모리 fake DB (테스트 전용)
 *
 * Prisma 를 대체하지 않고, 서비스 코어가 사용하는 최소 연산(findFirst/findMany/create/updateMany/deleteMany)만 흉내 낸다.
 *  - itemSupplier 는 읽을 때 supplier(BusinessPartner)를 join 해 where.supplier / include.supplier 가 동작한다.
 *  - DB 제약 흉내: (tenantId,itemId,supplierId) 유일, 품목당 ACTIVE Default 최대 1개 → 위반 시 P2002.
 *  - $transaction: 스냅샷 후 예외가 나면 롤백한다.
 *  - reads / writes 를 기록해 "DB write 0건", "쿼리 수" 를 검증한다.
 */

export type Row = Record<string, any>

const OPS = ["in", "notIn", "not", "gt", "gte", "lt", "lte", "equals", "contains", "mode"]

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const keys = Object.keys(cond as object)
    if (keys.length > 0 && keys.every((k) => OPS.includes(k))) {
      const c = cond as Record<string, any>
      return keys.every((k) => {
        const a = actual as any
        const v = c[k]
        if (k === "in") return (v as unknown[]).includes(actual)
        if (k === "notIn") return !(v as unknown[]).includes(actual)
        if (k === "not") return a !== v
        if (k === "equals") return a === v
        if (k === "gt") return a > v
        if (k === "gte") return a >= v
        if (k === "lt") return a < v
        if (k === "lte") return a <= v
        if (k === "contains") {
          const insensitive = c.mode === "insensitive"
          const hay = String(a ?? "")
          return insensitive ? hay.toLowerCase().includes(String(v).toLowerCase()) : hay.includes(String(v))
        }
        return true // mode
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

export type Seed = {
  item?: Row[]
  businessPartner?: Row[]
  itemSupplier?: Row[]
  itemPrice?: Row[]
}

export function makeFakeMasterDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    item: (seed.item ?? []).map((r) => ({ ...r })),
    businessPartner: (seed.businessPartner ?? []).map((r) => ({ ...r })),
    itemSupplier: (seed.itemSupplier ?? []).map((r) => ({ ...r })),
    itemPrice: (seed.itemPrice ?? []).map((r) => ({ ...r })),
    auditLog: [],
  }
  const reads: Array<{ model: string; op: string; where: Row }> = []
  const writes: Array<{ model: string; op: string; data?: Row; where?: Row }> = []
  const failNext: { auditLog: boolean } = { auditLog: false }
  let seq = 1

  function joined(name: string, row: Row): Row {
    if (name === "itemSupplier") {
      const supplier = tables.businessPartner.find((p) => p.id === row.supplierId) ?? null
      return { ...row, supplier }
    }
    if (name === "itemPrice") {
      const item = tables.item.find((i) => i.id === row.itemId) ?? null
      const partner = tables.businessPartner.find((p) => p.id === row.partnerId) ?? null
      return { ...row, item, partner }
    }
    return { ...row }
  }
  function filter(name: string, where?: Row) {
    return tables[name].map((r) => joined(name, r)).filter((r) => (where ? matches(r, where) : true))
  }
  function sortRows(rows: Row[], orderBy: any) {
    if (!orderBy) return rows
    const orders: Array<Record<string, "asc" | "desc">> = Array.isArray(orderBy) ? orderBy : [orderBy]
    return [...rows].sort((a, b) => {
      for (const o of orders) {
        const [field, dir] = Object.entries(o)[0]
        const av = a[field]
        const bv = b[field]
        if (av === bv) continue
        const cmp = av > bv ? 1 : -1
        return dir === "desc" ? -cmp : cmp
      }
      return 0
    })
  }

  function assertConstraints() {
    const seen = new Set<string>()
    const defaults = new Set<string>()
    for (const r of tables.itemSupplier) {
      const key = `${r.tenantId}|${r.itemId}|${r.supplierId}`
      if (seen.has(key)) throw Object.assign(new Error("Unique constraint failed (item,supplier)"), { code: "P2002" })
      seen.add(key)
      if (r.isDefault && r.isActive) {
        const dk = `${r.tenantId}|${r.itemId}`
        if (defaults.has(dk)) throw Object.assign(new Error("Unique constraint failed (active default)"), { code: "P2002" })
        defaults.add(dk)
      }
      if (!r.isActive && r.isDefault) throw new Error("CHECK inactive_not_default violated")
      if (r.moq !== null && r.moq !== undefined && !(r.moq > 0)) throw new Error("CHECK moq violated")
      if (r.orderMultiple !== null && r.orderMultiple !== undefined && !(r.orderMultiple > 0)) {
        throw new Error("CHECK orderMultiple violated")
      }
      if (r.leadTimeDays !== null && r.leadTimeDays !== undefined && !(r.leadTimeDays >= 0)) {
        throw new Error("CHECK leadTimeDays violated")
      }
    }
  }

  const model = (name: string) => ({
    findFirst: async (a: { where?: Row; orderBy?: any }) => {
      reads.push({ model: name, op: "findFirst", where: a?.where ?? {} })
      return sortRows(filter(name, a?.where), a?.orderBy)[0] ?? null
    },
    findMany: async (a?: { where?: Row; orderBy?: any; take?: number }) => {
      reads.push({ model: name, op: "findMany", where: a?.where ?? {} })
      let rows = sortRows(filter(name, a?.where), a?.orderBy)
      if (a?.take !== undefined) rows = rows.slice(0, a.take)
      return rows
    },
    create: async (a: { data: Row }) => {
      writes.push({ model: name, op: "create", data: a.data })
      if (name === "auditLog" && failNext.auditLog) {
        failNext.auditLog = false
        throw new Error("audit write failed")
      }
      const row: Row = {
        id: `${name}-${seq++}`,
        createdAt: new Date("2026-10-14T00:00:00Z"),
        ...(name === "itemSupplier"
          ? { isDefault: false, priority: 100, leadTimeDays: null, moq: null, orderMultiple: null, isActive: true }
          : {}),
        ...a.data,
      }
      tables[name].push(row)
      if (name === "itemSupplier") {
        try {
          assertConstraints()
        } catch (e) {
          tables[name].pop()
          throw e
        }
      }
      return { ...row }
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      writes.push({ model: name, op: "updateMany", data: a.data, where: a.where })
      const targets = tables[name].filter((r) => matches(joined(name, r), a.where))
      const before = targets.map((r) => ({ ...r }))
      for (const r of targets) Object.assign(r, a.data)
      if (name === "itemSupplier") {
        try {
          assertConstraints()
        } catch (e) {
          targets.forEach((r, i) => Object.assign(r, before[i]))
          throw e
        }
      }
      return { count: targets.length }
    },
    deleteMany: async (a: { where: Row }) => {
      writes.push({ model: name, op: "deleteMany", where: a.where })
      const keep: Row[] = []
      let count = 0
      for (const r of tables[name]) {
        if (matches(joined(name, r), a.where)) count += 1
        else keep.push(r)
      }
      tables[name] = keep
      return { count }
    },
  })

  const db: any = {
    item: model("item"),
    businessPartner: model("businessPartner"),
    itemSupplier: model("itemSupplier"),
    itemPrice: model("itemPrice"),
    auditLog: model("auditLog"),
    $transaction: async (cb: (tx: any) => Promise<unknown>) => {
      const rawSnapshot: Record<string, Row[]> = {}
      for (const [k, rows] of Object.entries(tables)) rawSnapshot[k] = rows.map((r) => ({ ...r }))
      try {
        return await cb(db)
      } catch (e) {
        for (const k of Object.keys(tables)) tables[k] = rawSnapshot[k]
        throw e
      }
    },
  }

  return {
    db,
    tables,
    reads,
    writes,
    failNext,
    countReads: (name?: string) => reads.filter((r) => !name || r.model === name).length,
    countWrites: (name?: string) => writes.filter((w) => !name || w.model === name).length,
    resetStats() {
      reads.length = 0
      writes.length = 0
    },
  }
}
