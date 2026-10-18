/**
 * 대원정밀 NCWatch 연동 운영 도구 (Phase 12).
 *
 *   inspect     READ ONLY. 테넌트/사업장/설비/Gateway/매핑/태그/수신 현황을 조회한다. (키·비밀번호 출력 없음)
 *   verify-key  READ ONLY. 운영 키 파일(--key-file)로 신/구 서버 인증 방식의 호환성을 점검한다(출력에 키·해시 없음).
 *   provision   dry-run 이 기본. `--apply` + `--confirm-tenant <id>` 가 모두 있어야만 쓴다.
 *               - "NCWatch Agent" Gateway 재사용(없을 때만 생성), 설비 4대 NCWatch 매핑/연결/기본 태그 생성(없는 것만).
 *               - 기존 데이터는 수정/삭제하지 않는다(설비 미존재 시 임의 연결 금지 → 해당 설비만 건너뜀).
 *               - `--issue-key <파일>` 을 주면 새 운영 키를 발급해 Gateway 에 해시로 저장하고, 평문은 지정 파일에만 쓴다(콘솔 출력 없음).
 *                 (기존 키가 있는 Gateway 는 `--rotate-key` 를 같이 줘야 교체. 교체 시 기존 키는 즉시 무효.)
 *
 * 실행 (DATABASE_URL 은 환경변수 또는 .env.local 에서 읽는다):
 *   npx ts-node --compiler-options "{\"module\":\"commonjs\"}" --project tsconfig.json scripts/ncwatch-ops.ts inspect [--tenant daewon-001]
 *   npx ts-node ... scripts/ncwatch-ops.ts provision [--tenant daewon-001]                         # dry-run
 *   npx ts-node ... scripts/ncwatch-ops.ts provision --tenant daewon-001 --apply --confirm-tenant daewon-001 --issue-key <키파일>
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PrismaClient } from "@prisma/client"
import { generateAgentKey, hashAgentKey, isPresentableAgentKey, isStoredAgentKeyHash } from "../src/lib/ncwatch/agent-key"
import { NCWATCH_DEFAULT_TAGS, NCWATCH_GATEWAY_NAME } from "../src/lib/ncwatch/provision"

/** 연동 대상 설비 — NCWatch 수집 기계명 = MES 설비 코드(이름) 로 매핑한다. */
const TARGET_MACHINES = ["CNC-1", "CNC-8", "CNC-9", "MCT-6"] as const

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null
}
const has = (name: string) => process.argv.includes(`--${name}`)

/** .env.local 의 값을 process.env 에 채운다(이미 설정된 값은 유지). 값은 출력하지 않는다. */
function loadEnvLocal() {
  const file = join(process.cwd(), ".env.local")
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1")
  }
}

/** Supabase transaction pooler(6543)는 prepared statement 미지원 → 앱(prisma.ts)과 동일하게 pgbouncer=true 를 붙인다. */
function normalizeDatabaseUrl() {
  const raw = process.env.DATABASE_URL
  if (!raw) return
  const u = new URL(raw)
  if (u.port === "6543" && !u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true")
  if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "1")
  process.env.DATABASE_URL = u.toString()
}

function maskHost(url: string | undefined): string {
  if (!url) return "(미설정)"
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || "(default)"}`
  } catch {
    return "(해석 불가)"
  }
}

async function inspect(prisma: PrismaClient, tenantId: string) {
  console.log(`DB host      : ${maskHost(process.env.DATABASE_URL)}`)
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } })
      console.log(`\n[테넌트] ${tenant ? `${tenant.id} / ${tenant.name}` : "없음 → 중단"}`)
      if (!tenant) return

      const sites = await tx.site.findMany({ where: { tenantId }, select: { id: true, code: true, name: true } })
      console.log(`[사업장] ${sites.length}건`)
      for (const s of sites) console.log(`  - ${s.id} / ${s.code} / ${s.name}`)

      const enumRows = await tx.$queryRawUnsafe<{ enumlabel: string }[]>(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ConnectionProtocol'`
      )
      console.log(`[ConnectionProtocol enum] ${enumRows.map((r) => r.enumlabel).join(", ")}`)

      const gateways = await tx.edgeGateway.findMany({
        where: { tenantId },
        select: {
          id: true, name: true, siteId: true, status: true, lastHeartbeat: true, apiKey: true,
          _count: { select: { connections: true } },
        },
      })
      console.log(`\n[Gateway] ${gateways.length}건 (키는 출력하지 않음)`)
      for (const g of gateways) {
        const keyKind = isStoredAgentKeyHash(g.apiKey) ? "해시저장" : "평문저장(구형)"
        console.log(
          `  - ${g.id} / ${g.name} / site=${g.siteId} / ${g.status} / hb=${g.lastHeartbeat?.toISOString() ?? "-"} / key=${keyKind} / 연결=${g._count.connections}`
        )
      }
      const named = gateways.filter((g) => g.name === NCWATCH_GATEWAY_NAME)
      console.log(`  → "${NCWATCH_GATEWAY_NAME}" 이름의 Gateway: ${named.length}건`)

      const workCenters = await tx.workCenter.findMany({ where: { site: { tenantId } }, select: { id: true, code: true, name: true, kind: true, siteId: true } })
      console.log(`
[작업장 WorkCenter] ${workCenters.length}건 (설비 신규 등록 시 필수 참조)`)
      for (const w of workCenters) console.log(`  - ${w.id} / ${w.code} / ${w.name} / ${w.kind} / site=${w.siteId}`)

      const equipments = await tx.equipment.findMany({
        where: { tenantId },
        select: { id: true, code: true, name: true, siteId: true, status: true },
        orderBy: { code: "asc" },
      })
      console.log(`\n[설비] 전체 ${equipments.length}건`)
      for (const e of equipments) console.log(`  - ${e.id} / ${e.code} / ${e.name} / site=${e.siteId} / ${e.status}`)

      console.log("\n[대상 4대 매칭 (코드 또는 이름 정확 일치)]")
      for (const machine of TARGET_MACHINES) {
        const hit = equipments.filter((e) => e.code === machine || e.name === machine)
        console.log(`  - ${machine}: ${hit.length === 1 ? `1건 → ${hit[0].id}` : hit.length === 0 ? "없음(임의 연결하지 않음)" : `${hit.length}건 중복 → 수동 확인 필요`}`)
      }

      const mappings = await tx.ncwatchEquipmentMapping.findMany({ where: { tenantId } })
      console.log(`\n[NcwatchEquipmentMapping] ${mappings.length}건`)
      for (const m of mappings) console.log(`  - ${m.machineName} → ${m.equipmentId ?? "(미매핑)"} / active=${m.isActive}`)

      const conns = await tx.equipmentConnection.findMany({
        where: { equipment: { tenantId }, protocol: "NCWATCH_AGENT" },
        select: { id: true, equipmentId: true, gatewayId: true, isActive: true, _count: { select: { tags: true } } },
      })
      console.log(`[EquipmentConnection NCWATCH_AGENT] ${conns.length}건`)
      for (const c of conns) console.log(`  - ${c.id} / eq=${c.equipmentId} / gw=${c.gatewayId} / active=${c.isActive} / tags=${c._count.tags}`)

      const statuses = await tx.ncwatchStatus.findMany({
        where: { tenantId },
        select: { machineName: true, statusCode: true, receivedAt: true },
      })
      console.log(`[NcwatchStatus 수신 행] ${statuses.length}건`)
      for (const s of statuses) console.log(`  - ${s.machineName} / status=${s.statusCode} / received=${s.receivedAt.toISOString()}`)

      const [hist, logs] = await Promise.all([
        tx.ncwatchStatusHistory.count({ where: { tenantId } }),
        tx.ncwatchSyncLog.count({ where: { tenantId } }),
      ])
      console.log(`[NcwatchStatusHistory] ${hist}건 / [NcwatchSyncLog] ${logs}건`)
    },
    { timeout: 60000 }
  )
}

async function provision(prisma: PrismaClient, tenantId: string) {
  const apply = has("apply")
  const keyOut = arg("issue-key")
  const rotate = has("rotate-key")
  if (apply && arg("confirm-tenant") !== tenantId) {
    throw new Error(`--apply 는 --confirm-tenant ${tenantId} 가 함께 필요합니다.`)
  }
  console.log(`DB host : ${maskHost(process.env.DATABASE_URL)}`)
  console.log(`모드    : ${apply ? "APPLY (운영 DB 쓰기)" : "DRY-RUN (쓰기 없음)"}`)

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } })
  if (!tenant) throw new Error(`테넌트 ${tenantId} 를 찾을 수 없습니다.`)
  console.log(`테넌트  : ${tenant.id} / ${tenant.name}`)

  const equipments = await prisma.equipment.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true, siteId: true },
  })

  // 설비가 없을 때만 `--create-equipment --work-center <코드>` 로 신규 등록한다(기존 설비는 수정하지 않음).
  const createEquipment = has("create-equipment")
  let workCenter: { id: string; code: string; siteId: string } | null = null
  if (createEquipment) {
    const wcCode = arg("work-center")
    if (!wcCode) throw new Error("--create-equipment 는 --work-center <작업장 코드> 가 필요합니다.")
    const wcs = await prisma.workCenter.findMany({
      where: { code: wcCode, site: { tenantId } },
      select: { id: true, code: true, siteId: true },
    })
    if (wcs.length !== 1) throw new Error(`작업장 ${wcCode} 를 정확히 1건 찾지 못했습니다(${wcs.length}건).`)
    workCenter = wcs[0]
  }

  type Plan = { machine: string; equipmentId: string | null; siteId: string }
  const plans: Plan[] = []
  for (const machine of TARGET_MACHINES) {
    const hit = equipments.filter((e) => e.code === machine || e.name === machine)
    if (hit.length === 0 && workCenter) {
      plans.push({ machine, equipmentId: null, siteId: workCenter.siteId })
      console.log(`  + ${machine}: MES 설비 없음 → 신규 등록 예정 (MACHINE / ACTIVE / 작업장 ${workCenter.code})`)
      continue
    }
    if (hit.length !== 1) {
      console.log(`  ✗ ${machine}: MES 설비 ${hit.length === 0 ? "없음" : "중복"} → 건너뜀 (임의 연결 금지)`)
      continue
    }
    plans.push({ machine, equipmentId: hit[0].id, siteId: hit[0].siteId })
    console.log(`  ✓ ${machine}: equipment=${hit[0].id} site=${hit[0].siteId}`)
  }
  if (plans.length === 0) {
    console.log("매핑 가능한 설비가 없어 종료합니다.")
    return
  }

  const siteIds = Array.from(new Set(plans.map((p) => p.siteId)))
  if (siteIds.length !== 1) throw new Error(`설비들의 사업장이 일치하지 않습니다: ${siteIds.join(", ")} — 수동 확인 필요`)
  const siteId = siteIds[0]

  const existingGateways = await prisma.edgeGateway.findMany({
    where: { tenantId, siteId, name: NCWATCH_GATEWAY_NAME },
    select: { id: true, apiKey: true },
  })
  if (existingGateways.length > 1) throw new Error(`"${NCWATCH_GATEWAY_NAME}" Gateway 가 ${existingGateways.length}건 — 수동 정리 후 재실행하세요.`)
  const gw = existingGateways[0] ?? null
  console.log(`Gateway : ${gw ? `재사용 ${gw.id}` : `"${NCWATCH_GATEWAY_NAME}" 신규 생성 예정`}`)

  const existingMappings = await prisma.ncwatchEquipmentMapping.findMany({
    where: { tenantId, machineName: { in: plans.map((p) => p.machine) } },
  })
  for (const p of plans) {
    const m = existingMappings.find((x) => x.machineName === p.machine)
    if (m?.equipmentId && p.equipmentId && m.equipmentId !== p.equipmentId) {
      throw new Error(`${p.machine}: 기존 매핑이 다른 설비(${m.equipmentId})를 가리킵니다 — 자동 변경하지 않습니다.`)
    }
    console.log(`  - 매핑 ${p.machine}: ${m ? (m.equipmentId ? "이미 존재(유지)" : "행 존재, equipment 비어있음 → 연결") : "신규"}`)
  }

  const willIssueKey = Boolean(keyOut) && (!gw || rotate)
  if (keyOut && gw && !rotate) {
    console.log("키      : 기존 Gateway 키 유지 (교체하려면 --rotate-key). --issue-key 는 무시됩니다.")
  }
  console.log(`키 발급 : ${willIssueKey ? `예정 → ${keyOut} 에만 저장 (콘솔 출력 없음)${gw ? " [기존 키 즉시 무효화]" : ""}` : "없음"}`)

  if (!apply) {
    console.log("\nDRY-RUN 종료 — 쓰기 0건.")
    return
  }

  // ── 복구용 사전 상태 기록 (쓰기 전에 파일로 저장; 구형 Gateway 키 값이 들어 있으므로 저장소 밖 보안 폴더에만 둔다) ──
  const snapshotOut = arg("snapshot-out")
  if (!snapshotOut) throw new Error("--apply 는 --snapshot-out <파일> (복구용 사전 상태 기록)이 필요합니다.")
  if (existsSync(snapshotOut)) throw new Error(`스냅샷 파일이 이미 있습니다(덮어쓰지 않음): ${snapshotOut}`)
  const preGateway = gw ? await prisma.edgeGateway.findUnique({ where: { id: gw.id } }) : null
  const preEquipmentCount = await prisma.equipment.count({ where: { tenantId } })
  const preSite = await prisma.site.findUnique({ where: { id: siteId } })
  const preTagCount = await prisma.dataTag.count({ where: { connection: { equipment: { tenantId } } } })
  writeFileSync(
    snapshotOut,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(), tenantId, tenantName: tenant.name, site: preSite, workCenter,
        gatewayBeforeChange: preGateway, // apiKey 원본 포함 — 외부 공유 금지
        existingEquipmentCount: preEquipmentCount, existingMappings, existingDataTagCount: preTagCount,
        plan: plans.map((p) => ({ machine: p.machine, existingEquipmentId: p.equipmentId })),
        rollbackHint: "신규 생성 레코드(설비·매핑·연결·태그)는 created 파일의 ID 로 삭제, Gateway 는 gatewayBeforeChange.apiKey 로 복원",
      },
      null, 2
    ),
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  )
  console.log(`사전 상태 기록: ${snapshotOut} (비밀 포함 — 저장소/채팅에 공유 금지)`)

  // ── 새 키는 DB 변경 전에 파일로 먼저 저장하고, 트랜잭션이 실패하면 파일을 지운다 ──
  let plainKey: string | null = null
  if (willIssueKey && keyOut) {
    plainKey = generateAgentKey()
    writeFileSync(keyOut, plainKey + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" })
  }
  const createdEquipmentIds: string[] = []
  let result: { gatewayId: string }
  try {
  result = await prisma.$transaction(async (tx) => {
    const apiKey = plainKey
    const gateway = gw
      ? apiKey
        ? await tx.edgeGateway.update({ where: { id: gw.id }, data: { apiKey: hashAgentKey(apiKey) }, select: { id: true } })
        : { id: gw.id }
      : await tx.edgeGateway.create({
          data: {
            tenantId,
            siteId,
            name: NCWATCH_GATEWAY_NAME,
            description: "Daewon NCWatch Agent push gateway",
            status: "OFFLINE",
            // 평문 발급이 요청되지 않아도 추측 불가능한 해시값으로 저장해 구형(cuid) 기본키가 남지 않게 한다.
            apiKey: hashAgentKey(apiKey ?? generateAgentKey()),
          },
          select: { id: true },
        })

    for (const plan of plans) {
      let equipmentId = plan.equipmentId
      if (!equipmentId && workCenter) {
        const created = await tx.equipment.create({
          data: { tenantId, siteId: workCenter.siteId, workCenterId: workCenter.id, code: plan.machine, name: plan.machine, equipmentType: "MACHINE", status: "ACTIVE" },
          select: { id: true },
        })
        equipmentId = created.id
        createdEquipmentIds.push(created.id)
      }
      if (!equipmentId) continue
      const p = { ...plan, equipmentId }
      const m = existingMappings.find((x) => x.machineName === p.machine)
      if (!m) {
        await tx.ncwatchEquipmentMapping.create({
          data: { tenantId, siteId: p.siteId, machineName: p.machine, equipmentId: p.equipmentId, isActive: true, memo: "Phase12 provision" },
        })
      } else if (!m.equipmentId) {
        await tx.ncwatchEquipmentMapping.update({ where: { id: m.id }, data: { equipmentId: p.equipmentId, siteId: p.siteId } })
      }
      const connection = await tx.equipmentConnection.upsert({
        where: { equipmentId_gatewayId: { equipmentId: p.equipmentId, gatewayId: gateway.id } },
        update: { protocol: "NCWATCH_AGENT", isActive: true, config: { machineName: p.machine } },
        create: { equipmentId: p.equipmentId, gatewayId: gateway.id, protocol: "NCWATCH_AGENT", host: null, port: null, config: { machineName: p.machine }, isActive: true },
        select: { id: true },
      })
      for (const tag of NCWATCH_DEFAULT_TAGS) {
        await tx.dataTag.upsert({
          where: { connectionId_tagCode: { connectionId: connection.id, tagCode: tag.tagCode } },
          update: {}, // 기존 태그는 수정하지 않는다.
          create: {
            connectionId: connection.id, tagCode: tag.tagCode, displayName: tag.displayName, dataType: tag.dataType,
            unit: tag.unit, category: tag.category, plcAddress: tag.plcAddress, samplingMs: 10000, isActive: true,
            isEnabled: true, isVisible: tag.isVisible, isPrimary: tag.isPrimary, displayOrder: tag.displayOrder, source: "NCWATCH",
          },
        })
      }
    }
    await tx.auditLog.create({
      data: {
        tenantId, actorType: "SYSTEM", actorLabel: "ncwatch-ops provision", entityType: "NcwatchProvision", entityId: gateway.id, action: "CREATE",
        afterData: { machines: plans.map((p) => p.machine), gatewayId: gateway.id, keyIssued: Boolean(apiKey), createdEquipmentIds },
        menuName: "설비연결설정",
      },
    })
    return { gatewayId: gateway.id }
  }, { timeout: 60000 })
  } catch (e) {
    if (plainKey && keyOut) {
      try { unlinkSync(keyOut) } catch { /* ignore */ }
    }
    throw e
  }

  console.log(`\nAPPLY 완료(트랜잭션 커밋): gateway=${result.gatewayId}`)
  if (plainKey && keyOut) console.log(`운영 키는 ${keyOut} 에만 저장되었습니다(콘솔 출력 없음).`)

  // ── 사후 검증 (읽기) ──
  const createdFile = snapshotOut.replace(/\.json$/i, "") + ".created.json"
  const equipmentAfter = await prisma.equipment.findMany({
    where: { tenantId, code: { in: plans.map((p) => p.machine) } },
    select: { id: true, code: true, name: true, siteId: true, workCenterId: true, equipmentType: true, status: true },
    orderBy: { code: "asc" },
  })
  const mappingsAfter = await prisma.ncwatchEquipmentMapping.findMany({ where: { tenantId, machineName: { in: plans.map((p) => p.machine) } }, orderBy: { machineName: "asc" } })
  const connsAfter = await prisma.equipmentConnection.findMany({
    where: { gatewayId: result.gatewayId, protocol: "NCWATCH_AGENT" },
    select: { id: true, equipmentId: true, isActive: true, _count: { select: { tags: true } } },
  })
  const gatewayCount = await prisma.edgeGateway.count({ where: { tenantId, name: NCWATCH_GATEWAY_NAME } })
  const gatewayAfter = await prisma.edgeGateway.findUnique({ where: { id: result.gatewayId }, select: { id: true, apiKey: true, status: true, siteId: true } })
  const keyVerified = plainKey ? (await prisma.edgeGateway.findUnique({ where: { apiKey: hashAgentKey(plainKey) }, select: { id: true } }))?.id === result.gatewayId : null
  writeFileSync(
    createdFile,
    JSON.stringify({ equipment: equipmentAfter, mappings: mappingsAfter.map((m) => ({ id: m.id, machineName: m.machineName, equipmentId: m.equipmentId })), connections: connsAfter }, null, 2),
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  )
  console.log("\n[사후 검증]")
  for (const e of equipmentAfter) console.log(`  설비 ${e.code} id=${e.id} site=${e.siteId} workCenter=${e.workCenterId} ${e.equipmentType}/${e.status}`)
  for (const m of mappingsAfter) console.log(`  매핑 ${m.machineName} → ${m.equipmentId} active=${m.isActive}`)
  for (const c of connsAfter) console.log(`  연결 ${c.id} eq=${c.equipmentId} active=${c.isActive} 태그=${c._count.tags}`)
  console.log(`  "${NCWATCH_GATEWAY_NAME}" Gateway 수: ${gatewayCount} (재사용 id=${gatewayAfter?.id}, 해시저장=${gatewayAfter ? isStoredAgentKeyHash(gatewayAfter.apiKey) : "?"}, status=${gatewayAfter?.status})`)
  console.log(`  새 키 → 해시 조회로 동일 Gateway 식별: ${keyVerified === null ? "해당 없음" : keyVerified}`)
  console.log(`  생성 레코드 기록: ${createdFile}`)
}

/**
 * 운영 인증키 호환성 점검 (READ ONLY, 키·해시 값은 출력하지 않고 true/false 만 출력).
 *  - 신규 서버(auth.ts)가 쓰는 해시 조회와, 구버전 서버(main: 평문 조회)가 쓰는 조회를 각각 재현한다.
 *  - 이 점검은 하트비트를 전송하지 않으므로 Gateway 상태/시각을 바꾸지 않는다.
 */
async function verifyKey(prisma: PrismaClient, tenantId: string) {
  const keyFile = arg("key-file")
  if (!keyFile) throw new Error("--key-file <파일> 이 필요합니다.")
  const key = readFileSync(keyFile, "utf8").trim()
  const show = (label: string, value: unknown) => console.log(`  ${label}: ${value}`)
  console.log(`DB host : ${maskHost(process.env.DATABASE_URL)}`)
  console.log(`키 형식 : 길이충족(>=40)=${key.length >= 40}, dwk_ 접두=${key.startsWith("dwk_")}, 해시형식 아님=${!key.startsWith("sha256:")}`)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    const expected = await tx.edgeGateway.findMany({ where: { tenantId, name: NCWATCH_GATEWAY_NAME }, select: { id: true, tenantId: true, siteId: true, apiKey: true } })
    show('"NCWatch Agent" Gateway 수', expected.length)
    const gw = expected[0]
    show("저장된 키가 sha256 해시", gw ? isStoredAgentKeyHash(gw.apiKey) : "?")

    // 신규 서버 방식 (src/lib/ncwatch/auth.ts 1단계): 제시 키를 해시해 조회
    const hashed = await tx.edgeGateway.findUnique({ where: { apiKey: hashAgentKey(key) }, select: { id: true, tenantId: true, siteId: true } })
    console.log("[신규 서버(Phase 10+) 인증 방식]")
    show("새 키 → Gateway 식별됨", Boolean(hashed))
    show("식별된 Gateway 가 기존 NCWatch Agent Gateway 와 동일", hashed?.id === gw?.id)
    show("tenant 가 대원정밀(" + tenantId + ")로 확정", hashed?.tenantId === tenantId)
    show("siteId 일치", hashed?.siteId === gw?.siteId)
    show("저장된 해시값 자체를 키로 제시하면 거부(접두 sha256: 차단)", !isPresentableAgentKey(gw?.apiKey ?? ""))
    const wrong = await tx.edgeGateway.findUnique({ where: { apiKey: hashAgentKey(generateAgentKey()) }, select: { id: true } })
    show("임의의 잘못된 키 → 식별 안 됨", wrong === null)
    show('데모 키 "gw-api-key-demo-001" → 식별 안 됨', (await tx.edgeGateway.findUnique({ where: { apiKey: hashAgentKey("gw-api-key-demo-001") }, select: { id: true } })) === null)

    // 구버전 서버 방식 (main 의 auth.ts): 제시 키 원문을 그대로 조회
    const legacy = await tx.edgeGateway.findUnique({ where: { apiKey: key }, select: { id: true } })
    console.log("[현재 운영 배포본(main 계열, 평문 조회) 인증 방식]")
    show("새 키 → Gateway 식별됨", Boolean(legacy))

    const others = await tx.edgeGateway.count({ where: { tenantId: { not: tenantId } } })
    show("다른 테넌트 Gateway 수(이 키와 무관해야 함)", others)

    // 수신 변환(transform.ts)이 설비마다 실행하는 것과 같은 조건으로 매핑·태그를 조회한다(쓰기 없음).
    console.log("[코드↔DB 호환성: 매핑된 설비별 변환 경로 조회]")
    const maps = await tx.ncwatchEquipmentMapping.findMany({
      where: { tenantId, isActive: true },
      select: { machineName: true, equipmentId: true, equipment: { select: { tenantId: true } } },
      orderBy: { machineName: "asc" },
    })
    for (const m of maps) {
      const tags = m.equipmentId
        ? await tx.dataTag.count({
            where: { isActive: true, isEnabled: true, source: "NCWATCH", connection: { isActive: true, equipmentId: m.equipmentId, protocol: "NCWATCH_AGENT" } },
          })
        : 0
      show(`${m.machineName}`, `설비 테넌트 일치=${m.equipment?.tenantId === tenantId}, 활성 NCWATCH 태그=${tags}`)
    }

    console.log("[코드↔DB 호환성: 수신 경로가 쓰는 테이블 접근(count)]")
    const counts = {
      ncwatchStatus: await tx.ncwatchStatus.count(), ncwatchStatusHistory: await tx.ncwatchStatusHistory.count(),
      ncwatchSyncLog: await tx.ncwatchSyncLog.count(), ncwatchReportDaily: await tx.ncwatchReportDaily.count(),
      ncwatchEquipmentMapping: await tx.ncwatchEquipmentMapping.count({ where: { tenantId } }),
      equipmentEvent: await tx.equipmentEvent.count(), dataTag: await tx.dataTag.count({ where: { source: "NCWATCH" } }),
      tagCurrentValue: await tx.tagCurrentValue.count(), tagSnapshot: await tx.tagSnapshot.count(),
    }
    for (const [k, v] of Object.entries(counts)) show(k, v)
  }, { timeout: 60000 })
}

async function main() {
  loadEnvLocal()
  normalizeDatabaseUrl()
  const cmd = process.argv[2]
  const tenantId = arg("tenant") ?? process.env.DEFAULT_TENANT_ID ?? "daewon-001"
  const prisma = new PrismaClient({ log: [] })
  try {
    if (cmd === "inspect") await inspect(prisma, tenantId)
    else if (cmd === "provision") await provision(prisma, tenantId)
    else if (cmd === "verify-key") await verifyKey(prisma, tenantId)
    else {
      console.log("사용법: ncwatch-ops.ts <inspect|provision> [--tenant <id>] [--apply --confirm-tenant <id> [--issue-key <file>] [--rotate-key]]")
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e)
  process.exit(1)
})
