# NCWatch 연동 — Phase 2 수신 API 설계

> 상태: **설계 전용 (코드/schema/migration 실제 변경 없음)**
> 선행 문서: `docs/ncwatch-phase1-db-design.md`
> 적용 환경: new_mes 데모 먼저, cns-medical-mes 운영은 별도 승인 후
> 핵심 원칙: **현장 PC에 Supabase service_role key 없음. MES_AGENT_KEY 제한키 방식.**

---

## 1. 전체 흐름

```
┌─────────────────────────────────────────────────────────────────┐
│  현장 PC (NCWatch Agent)                                         │
│                                                                  │
│  ncwatch-agent                                                   │
│   ├── 10초마다: POST /api/lms/ncwatch/status                    │
│   ├── 1시간마다: POST /api/lms/ncwatch/report-daily             │
│   └── 주기적: POST /api/lms/ncwatch/heartbeat                   │
│   [헤더] X-Agent-Key: <MES_AGENT_KEY>                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  MES 서버 (Vercel / Next.js API Routes)                          │
│                                                                  │
│  1) X-Agent-Key 검증 → EdgeGateway.apiKey 조회                  │
│  2) tenantId / siteId 확인                                       │
│  3) ncwatch staging 테이블 저장 (upsert/insert)                  │
│  4) NcwatchEquipmentMapping 조회                                 │
│     ├── 매핑 있음 → native 모델 변환 실행                        │
│     └── 매핑 없음 → staging만 저장, UNMAPPED 로그               │
│  5) NcwatchSyncLog 기록                                          │
│  6) 응답 반환                                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. MES_AGENT_KEY 인증 방식

### 2.1 키 저장 위치

기존 `EdgeGateway` 모델의 `apiKey` 필드를 재사용한다.

```
EdgeGateway {
  id:       "gw_ncwatch_site-xxx"
  tenantId: "tenant-xxx"
  siteId:   "site-xxx"
  name:     "NCWatch Agent"
  apiKey:   "<uuid>"       ← MES_AGENT_KEY 값
  status:   ONLINE | OFFLINE
}
```

- 설비연결설정 화면에서 **사이트별 "NCWatch Agent" 게이트웨이 1건**을 생성하면 `apiKey`가 자동 발급된다(`@default(cuid())`).
- 이 `apiKey` 값을 현장 PC의 `.env`에 `MES_AGENT_KEY`로 넣는다.

### 2.2 인증 처리 흐름

```typescript
// 모든 ncwatch API 공통 미들웨어 역할
async function verifyAgentKey(request: Request): Promise<{
  tenantId: string
  siteId: string
  gatewayId: string
} | null> {
  const key = request.headers.get("X-Agent-Key")
  if (!key) return null

  const gateway = await prisma.edgeGateway.findUnique({
    where: { apiKey: key },
    select: { id: true, tenantId: true, siteId: true, status: true }
  })

  if (!gateway) return null
  return { tenantId: gateway.tenantId, siteId: gateway.siteId, gatewayId: gateway.id }
}
```

응답 코드:
- `401 Unauthorized` — X-Agent-Key 헤더 없음 또는 키 불일치
- `403 Forbidden` — 게이트웨이 비활성 상태(추후 고려)

### 2.3 현장 PC `.env` 변경

현재 `ncwatch-agent/.env`:
```env
# ▼ 제거 대상
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
# (혹은 SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ▼ 추가 대상
MES_API_URL=https://bseng.vercel.app      # or 로컬: http://localhost:3000
MES_AGENT_KEY=<EdgeGateway.apiKey 값>
```

### 2.4 ncwatch-agent 코드 수정 범위 (설계만, 미구현)

`agent.js`의 `getSupabase()` / `sb.from(...).upsert()` 블록 → `fetch(MES_API_URL + '/api/lms/ncwatch/status', { method:'POST', headers: {'X-Agent-Key': key, 'Content-Type':'application/json'}, body: JSON.stringify(payload) })`로 교체.

기존 `routes.js` (로컬 REST API 서버) 는 현장 PC 내부 디버그용으로 유지 가능.

---

## 3. tenant / site 식별 방식

| 정보 | 식별 경로 | 비고 |
|------|-----------|------|
| `tenantId` | `EdgeGateway.tenantId` (apiKey 조회 결과) | payload에 tenantId 불포함 — 키로 서버에서 확정 |
| `siteId` | `EdgeGateway.siteId` | 동일 |
| `gatewayId` | `EdgeGateway.id` | NcwatchSyncLog에 기록 가능 |

> 현장 PC는 키 하나만 들고 있으면 된다. tenant/site는 MES 서버가 키 테이블에서 조회해 결정한다. payload에 tenantId를 직접 받지 않으므로 테넌트 위조 불가.

---

## 4. API 엔드포인트 설계

### 4.1 `POST /api/lms/ncwatch/status`

**목적:** 10초마다 전 기계 상태 일괄 전송

**요청 헤더:**
```
X-Agent-Key: <MES_AGENT_KEY>
Content-Type: application/json
```

**요청 body — 배치(기계 1~N대):**
```json
{
  "machines": [
    {
      "machineName": "VM960",
      "statusCode": 3,
      "statusLabel": "START",
      "runCode": 3,
      "modeCode": 1,
      "messageCode": 100,
      "programName": "O1234",
      "oNumber": "O1234",
      "spindleSpeed": 2000,
      "feedRate": 500,
      "positionX": 10.530,
      "positionY": -5.210,
      "positionZ": 100.000,
      "toolNo": "T01",
      "partCount": 42,
      "blockNumber": 100,
      "blockTot": 500,
      "ratio": 100.0,
      "alarmCode": "",
      "alarmMessage": "",
      "aliveCount": 1234,
      "ncwatchTs": "2026-06-12T10:00:00"
    }
  ]
}
```

필드별 출처 (`mapper.js` normalizeStatusRow 기준):

| payload 필드 | NCWatch 원본 | 비고 |
|---|---|---|
| machineName | 파라미터 | 에이전트 NCWATCH_MACHINES 값 |
| statusCode | `row.STATUS` (parseInt) | 0~6 |
| statusLabel | STATUS_MAP[statusCode] | 예: "START" |
| runCode | `row.RUN` | 0~7 |
| modeCode | `row.MODE` | 0,1,3,4,5,9,10 |
| messageCode | `row.MESSAGE` | 100~203 |
| programName | `row.FILENAME` | |
| oNumber | `row.ONUM` | |
| spindleSpeed | `row.SPINDLE` (parseInt) | rpm |
| feedRate | `row.FEED` (parseInt) | mm/min |
| positionX/Y/Z | `row.AXIS_X/Y/Z` (parseFloat) | mm |
| toolNo | `row.TOOL_NUMBER` | |
| partCount | `row.PARTCOUNT` (parseInt) | |
| blockNumber | `row.BLOCKNUMBER` (parseInt) | |
| blockTot | `row.BLOCKTOT` (parseInt) | |
| ratio | `row.RATIO` (parseFloat) | % |
| alarmCode | `row.ALARM` | |
| alarmMessage | `row.ALARMMSG` | |
| aliveCount | `row.ALIVECOUNT` (parseInt) | |
| ncwatchTs | `row.TIMESTAMP_S` | NCWatch 원본 타임스탬프 |

**응답:**
```json
{
  "ok": true,
  "processed": 2,
  "unmapped": 1,
  "errors": 0,
  "machines": [
    { "machineName": "VM960", "result": "OK",       "equipmentId": "eq_xxx" },
    { "machineName": "VM850", "result": "OK",       "equipmentId": "eq_yyy" },
    { "machineName": "HM630", "result": "UNMAPPED", "equipmentId": null }
  ]
}
```

---

### 4.2 `POST /api/lms/ncwatch/report-daily`

**목적:** 1시간마다 일간 가동률/카운터 리포트 전송

**요청 body:**
```json
{
  "machines": [
    {
      "machineName": "VM960",
      "reportDate": "2026-06-12",
      "runTime": "06:32:10",
      "runPct": 81.5,
      "partCount": 42,
      "stopTime": "00:55:20",
      "stopPct": 11.5,
      "manualPct": 2.1,
      "alarmPct": 4.9,
      "offlinePct": 0.0,
      "manualTime": "00:10:05",
      "alarmTime": "00:23:40",
      "offlineTime": "00:00:00"
    }
  ]
}
```

**응답:** status와 동일 구조(processed/unmapped/errors).

---

### 4.3 `POST /api/lms/ncwatch/heartbeat`

**목적:** 에이전트 생존 신호. DB 저장 없이 EdgeGateway.lastHeartbeat만 갱신.

**요청 body:**
```json
{
  "agentVersion": "1.0.0",
  "machineCount": 6,
  "uptime": 3600
}
```

**처리:**
```typescript
await prisma.edgeGateway.update({
  where: { id: gatewayId },
  data: { status: "ONLINE", lastHeartbeat: new Date() }
})
```

**응답:**
```json
{ "ok": true, "serverTime": "2026-06-12T10:00:05.000Z" }
```

> 에이전트가 heartbeat를 N분 이상 보내지 않으면 EdgeGateway.status = OFFLINE으로 전환하는 스케줄 잡은 Phase 5 이후 검토.

---

## 5. 서버측 처리 로직 (status API 상세)

### 5.1 전체 처리 순서

```typescript
// POST /api/lms/ncwatch/status
export async function POST(request: Request) {
  // 1. 인증
  const auth = await verifyAgentKey(request)
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { tenantId, siteId, gatewayId } = auth
  const { machines } = await request.json()

  const results = []

  for (const m of machines) {
    try {
      // 2. ncwatch_status upsert
      const prevStatus = await upsertNcwatchStatus(tenantId, siteId, m)

      // 3. ncwatch_status_history insert (상태 변경 시만)
      if (prevStatus.statusCode !== m.statusCode) {
        await insertNcwatchStatusHistory(tenantId, m)
      }

      // 4. 매핑 조회
      const mapping = await getNcwatchMapping(tenantId, m.machineName)

      if (mapping?.equipmentId) {
        // 5a. native 모델 변환
        await transformToNativeModels(tenantId, mapping.equipmentId, m, prevStatus)
        results.push({ machineName: m.machineName, result: "OK", equipmentId: mapping.equipmentId })
      } else {
        // 5b. 미매핑 — staging만 저장
        results.push({ machineName: m.machineName, result: "UNMAPPED", equipmentId: null })
      }
    } catch (err) {
      results.push({ machineName: m.machineName, result: "ERROR", message: err.message })
    }
  }

  // 6. SyncLog 기록
  await writeSyncLog(tenantId, "status", results)

  return Response.json({
    ok: true,
    processed: results.filter(r => r.result === "OK").length,
    unmapped: results.filter(r => r.result === "UNMAPPED").length,
    errors:   results.filter(r => r.result === "ERROR").length,
    machines: results,
  })
}
```

---

### 5.2 ncwatch_status upsert 기준

키: `@@unique([tenantId, machineName])`

```typescript
async function upsertNcwatchStatus(tenantId, siteId, m) {
  // upsert 전 기존값 조회 (상태변경 감지용)
  const prev = await prisma.ncwatchStatus.findUnique({
    where: { tenantId_machineName: { tenantId, machineName: m.machineName } },
    select: { statusCode: true, alarmCode: true }
  })

  await prisma.ncwatchStatus.upsert({
    where: { tenantId_machineName: { tenantId, machineName: m.machineName } },
    update: {
      statusCode: m.statusCode,   statusLabel: m.statusLabel,
      runCode: m.runCode,         modeCode: m.modeCode,
      messageCode: m.messageCode, programName: m.programName,
      oNumber: m.oNumber,         spindleSpeed: m.spindleSpeed,
      feedRate: m.feedRate,       positionX: m.positionX,
      positionY: m.positionY,     positionZ: m.positionZ,
      toolNo: m.toolNo,           partCount: m.partCount,
      blockNumber: m.blockNumber, blockTot: m.blockTot,
      ratio: m.ratio,             alarmCode: m.alarmCode,
      alarmMessage: m.alarmMessage, aliveCount: m.aliveCount,
      ncwatchTs: m.ncwatchTs,     rawPayload: m,
    },
    create: {
      tenantId, siteId, machineName: m.machineName,
      // ... 위와 동일
      rawPayload: m,
    }
  })

  return prev ?? { statusCode: null, alarmCode: null } // null = 첫 수신
}
```

---

### 5.3 ncwatch_status_history insert 기준

**트리거:** 이전 `statusCode`와 현재 `statusCode`가 다를 때만 insert.
- 첫 수신(prev=null)도 "변경"으로 간주 → insert.
- 동일 상태 연속 수신(10초마다) → skip.

```typescript
async function insertNcwatchStatusHistory(tenantId, m) {
  await prisma.ncwatchStatusHistory.create({
    data: {
      tenantId,
      machineName:  m.machineName,
      statusCode:   m.statusCode,
      statusLabel:  m.statusLabel,
      partCount:    m.partCount,
      spindleSpeed: m.spindleSpeed,
      alarmMessage: m.alarmMessage ?? null,
      changedAt:    m.ncwatchTs ? new Date(m.ncwatchTs) : new Date(),
    }
  })
}
```

---

### 5.4 native 모델 변환 흐름 (매핑 있을 때)

```typescript
async function transformToNativeModels(tenantId, equipmentId, m, prev) {
  await Promise.all([
    syncEquipmentEvent(equipmentId, m, prev),
    syncTagValues(tenantId, equipmentId, m),
  ])
}
```

#### 5.4-A: EquipmentEvent 동기화

```
NCWatch statusCode → EquipmentEventType:
  3 (START)   → RUN
  5 (ALARM)   → ALARM
  0,1,2,6     → STOP
  4 (OFFLINE) → STOP  (+message: "OFFLINE")
```

처리 로직:

```typescript
async function syncEquipmentEvent(equipmentId, m, prev) {
  const newEventType = mapStatusToEventType(m.statusCode)   // RUN|STOP|ALARM
  const prevEventType = prev.statusCode != null
    ? mapStatusToEventType(prev.statusCode)
    : null

  // 이벤트 타입이 바뀌지 않았으면 skip (같은 상태 유지)
  if (newEventType === prevEventType) return

  const now = new Date()

  // 기존 열린 이벤트 닫기
  const openEvent = await prisma.equipmentEvent.findFirst({
    where: { equipmentId, endedAt: null },
    orderBy: { startedAt: "desc" }
  })

  if (openEvent) {
    const durationSec = Math.round((now.getTime() - openEvent.startedAt.getTime()) / 1000)
    await prisma.equipmentEvent.update({
      where: { id: openEvent.id },
      data: { endedAt: now, duration: durationSec }
    })
  }

  // 새 이벤트 열기
  await prisma.equipmentEvent.create({
    data: {
      equipmentId,
      eventType: newEventType,
      message: buildEventMessage(m),  // 알람이면 "[code] msg", OFFLINE이면 "OFFLINE"
      startedAt: m.ncwatchTs ? new Date(m.ncwatchTs) : now,
    }
  })
}
```

> `startedAt`에 `ncwatchTs`(NCWatch 원본 타임스탬프) 사용 → 에이전트 → MES 전송 지연이 있어도 이벤트 시각이 정확.

#### 5.4-B: TagCurrentValue / TagSnapshot 동기화

```typescript
async function syncTagValues(tenantId, equipmentId, m) {
  // NCWatch 필드 → tagCode 매핑 테이블 (고정)
  const FIELD_MAP: Record<string, keyof typeof m> = {
    STATUS:         "statusLabel",
    PROGRAM_NAME:   "programName",
    SPINDLE_SPEED:  "spindleSpeed",
    FEED_RATE:      "feedRate",
    POS_X:          "positionX",
    POS_Y:          "positionY",
    POS_Z:          "positionZ",
    TOOL_NO:        "toolNo",
    PART_COUNT:     "partCount",
    ALARM_CODE:     "alarmCode",
    ALARM_MESSAGE:  "alarmMessage",
  }

  // 대상 태그 조회: isActive=true, isEnabled=true, source='NCWATCH', 해당 equipment 연결
  const tags = await prisma.dataTag.findMany({
    where: {
      isActive: true,
      isEnabled: true,
      source: "NCWATCH",
      connection: { equipmentId, isActive: true }
    }
  })

  for (const tag of tags) {
    const fieldName = FIELD_MAP[tag.tagCode]
    if (!fieldName) continue

    const rawValue = m[fieldName]
    if (rawValue == null) continue

    const value = String(rawValue)
    const numericValue = isFinite(Number(rawValue)) ? Number(rawValue) : null
    const timestamp = m.ncwatchTs ? new Date(m.ncwatchTs) : new Date()

    // TagCurrentValue upsert (태그별 현재값 1행)
    await prisma.tagCurrentValue.upsert({
      where: { tagId: tag.id },
      update: { value, numericValue, quality: "GOOD", timestamp },
      create: { tagId: tag.id, value, numericValue, quality: "GOOD", timestamp }
    })

    // TagSnapshot insert 정책: 값이 변경된 경우만 (§7 보관정책)
    // 현재값과 비교해서 변경 시에만 — 여기서는 단순히 insert (추후 deadband/변경감지 추가)
    await prisma.tagSnapshot.create({
      data: { tagId: tag.id, value, quality: "GOOD", timestamp }
    })
  }
}
```

---

### 5.5 미매핑 machineName 처리

```typescript
// staging에는 정상 저장됨 (upsert)
// native 변환 skip
// SyncLog에 UNMAPPED 기록
// 응답에 UNMAPPED 포함

// 화면 노출: 설비연결설정 페이지에서
// → SELECT DISTINCT machineName FROM ncwatch_status WHERE tenantId=?
//   EXCEPT SELECT machineName FROM ncwatch_equipment_mapping WHERE tenantId=?
// = 미매핑 기계명 목록
```

---

## 6. NcwatchSyncLog 기록 정책

**기록 단위:** API 호출 1건당 1행 (배치 전체 요약).

```typescript
async function writeSyncLog(tenantId, endpoint, results) {
  const okCount    = results.filter(r => r.result === "OK").length
  const unmapped   = results.filter(r => r.result === "UNMAPPED").length
  const errors     = results.filter(r => r.result === "ERROR").length
  const overallResult =
    errors > 0 ? "ERROR" :
    unmapped > 0 && okCount === 0 ? "UNMAPPED" :
    "OK"

  await prisma.ncwatchSyncLog.create({
    data: {
      tenantId,
      endpoint,
      result:       overallResult,
      message:      errors > 0 ? results.find(r=>r.result==="ERROR")?.message : null,
      payloadCount: results.length,
    }
  })
}
```

**보관:** NcwatchSyncLog는 조회용이므로 retention 정책(예: 90일) 필요. Phase 5에서 정리 잡과 함께 결정.

---

## 7. 중복 수신 / 재처리 정책

| 상황 | 처리 |
|------|------|
| 동일 payload 재전송(네트워크 재시도) | ncwatch_status upsert → 무해. statusCode 동일 → history insert skip. TagCurrentValue upsert → 무해. |
| 에이전트 재시작 후 첫 수신 | prev=null → 상태 변경으로 간주 → history insert + EquipmentEvent 신규 생성. (의도된 동작) |
| 순서 역전(오래된 ncwatchTs가 나중에 도착) | ncwatchTs로 startedAt 설정 시 이벤트 시각 역전 가능. **초기에는 서버 수신 시각 우선** 사용 권장. (별도 정책 확정 전까지) |
| 대량 재처리(staging 보유 데이터 재변환) | staging의 rawPayload를 읽어 재변환하는 별도 backfill 스크립트 계획 → Phase 7 이후 |

---

## 8. 에러 처리 / 응답 코드

| 코드 | 상황 |
|------|------|
| 200 | 정상 (UNMAPPED 포함 — 부분 성공도 200) |
| 400 | payload 스키마 오류 (machines 배열 없음, 필수 필드 누락) |
| 401 | X-Agent-Key 없음 또는 미일치 |
| 500 | DB 오류 등 예외 (SyncLog에 ERROR 기록 후 응답) |

UNMAPPED는 에러가 아니므로 200으로 처리. 에이전트는 응답 body의 `machines[].result`를 파싱해 로그 출력 가능.

---

## 9. new_mes 환경에서만 테스트하는 절차

### 9.1 환경 분리 확인 (schema 반영 전)

```bash
# new_mes DB와 cns-medical-mes DB가 완전히 분리된 인스턴스인지 확인
# .env 파일에서 DATABASE_URL 호스트 비교
grep DATABASE_URL .env .env.local 2>/dev/null
```

> 같은 저장소이므로 코드/schema 변경은 공유되지만 **DB 인스턴스는 분리**되어 있어야 함. Supabase 프로젝트 ID로 확인.

### 9.2 Phase 1 migration — new_mes 한정 적용

```bash
# 1. 로컬에서 dev DB에 schema 변경 + 마이그레이션 파일 생성
npx prisma migrate dev --name add_ncwatch_integration

# 2. 생성된 migration SQL 검토
cat prisma/migrations/<타임스탬프>_add_ncwatch_integration/migration.sql

# 3. new_mes DB에만 적용 (DATABASE_URL이 new_mes를 가리킬 때)
node scripts/db-migrate.js
# 또는: npx prisma migrate deploy

# 4. 적용 확인
npx prisma studio   # ncwatch_* 테이블 존재 확인
```

> **cns-medical-mes 운영 DB에는 이 단계에서 절대 적용하지 않는다.**

### 9.3 API 로컬 테스트

```bash
# new_mes 로컬 dev 서버 실행
npm run dev

# 1) 헬스 확인
curl -X POST http://localhost:3000/api/lms/ncwatch/heartbeat \
  -H "X-Agent-Key: <EdgeGateway.apiKey>" \
  -H "Content-Type: application/json" \
  -d '{"agentVersion":"1.0.0","machineCount":1,"uptime":0}'

# 2) status 더미 payload — 매핑 없는 기계
curl -X POST http://localhost:3000/api/lms/ncwatch/status \
  -H "X-Agent-Key: <EdgeGateway.apiKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "machines": [{
      "machineName": "TEST-UNMAPPED",
      "statusCode": 3, "statusLabel": "START",
      "spindleSpeed": 1500, "feedRate": 300,
      "partCount": 5, "alarmCode": "", "alarmMessage": ""
    }]
  }'
# 기대 응답: { ok:true, unmapped:1 }

# 3) 매핑 등록 후 status payload — 매핑 있는 기계
# (설비연결설정 화면에서 매핑 등록 후 진행)
curl -X POST http://localhost:3000/api/lms/ncwatch/status \
  -H "X-Agent-Key: <EdgeGateway.apiKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "machines": [{
      "machineName": "VM960",
      "statusCode": 3, "statusLabel": "START",
      "spindleSpeed": 2000, "feedRate": 500,
      "partCount": 42, "alarmCode": "", "alarmMessage": "",
      "positionX": 10.5, "positionY": -5.2, "positionZ": 100.0
    }]
  }'
# 기대 결과: EquipmentEvent(RUN) 생성, TagCurrentValue 갱신 확인
```

### 9.4 테스트 체크리스트

| # | 시나리오 | 기대 결과 | 확인 |
|---|----------|-----------|------|
| T1 | 잘못된 키로 요청 | 401 | ☐ |
| T2 | 미매핑 기계 status 수신 | staging 저장 + UNMAPPED 로그 | ☐ |
| T3 | 매핑 후 status 수신 (가동) | EquipmentEvent(RUN) 생성 | ☐ |
| T4 | 상태 변경 (가동→정지) | 이전 이벤트 endedAt 닫힘 + STOP 신규 생성 | ☐ |
| T5 | 알람 수신 | EquipmentEvent(ALARM) + alarmMessage | ☐ |
| T6 | 알람 해제 (alarmCode 빈값) | ALARM 이벤트 endedAt 닫힘 | ☐ |
| T7 | 동일 payload 연속 수신 | upsert 무해, history 중복 insert 없음 | ☐ |
| T8 | TagCurrentValue 갱신 확인 | 파라미터보기 화면에서 값 표시 | ☐ |
| T9 | isVisible=false 태그 | 파라미터보기 화면 미노출 | ☐ |
| T10 | heartbeat | EdgeGateway.lastHeartbeat 갱신 | ☐ |
| T11 | report-daily 수신 | ncwatch_report_daily upsert | ☐ |
| T12 | 분석모니터링 화면 정상 표시 | 이벤트/태그 데이터 반영 | ☐ |
| T13 | 에러보기 화면 알람 표시 | T5 이벤트 목록 노출 | ☐ |

### 9.5 main push 시 운영 배포 영향 확인

```bash
# Vercel 프로젝트 연결 확인
# new_mes   → Vercel 프로젝트 A
# cns-medical-mes → Vercel 프로젝트 B

# 배포 스크립트 확인: db:deploy가 build에 포함되지 않았는지
grep "db:deploy\|migrate" package.json

# Vercel 환경변수에서 DATABASE_URL이 각각 분리된 Supabase 프로젝트인지 확인
# (Vercel 대시보드에서 각 프로젝트 Environment Variables 비교)
```

> **현 package.json의 `build` 스크립트 = `prisma generate && next build`** — migrate deploy 없음. 안전.

---

## 10. Phase 2에서 결정 필요한 잔여 질문

1. **TagSnapshot insert 빈도**: 현 설계는 매 수신(10초)마다 insert. 변경 감지(deadband) 또는 N초 다운샘플로 줄일지? (R6 스토리지 리스크)
2. **OFFLINE 감지 잡**: heartbeat가 N분 없으면 EdgeGateway.status=OFFLINE + EquipmentEvent(STOP, "OFFLINE") 자동 생성 — 별도 cron 잡 필요. Phase 5?
3. **ncwatchTs 역전 처리**: startedAt을 서버 수신 시각으로 할지, ncwatchTs 우선으로 할지 정책 확정.
4. **API rate limit**: 에이전트 1대가 10초마다 호출하는 구조라 Vercel serverless function 호출 비용 발생. 문제 없는지 확인.
5. **ncwatch-agent 코드 수정 시점**: Phase 2 API 구현 완료 후 현장 테스트 전에 에이전트 수정 필요. 수정 주체/일정 확인.

---

## 11. 다음 단계

Phase 2 API 설계 확정 → **Phase 3 설비연결설정 화면 수정 설계** 또는 실제 구현 착수.

구현 착수 순서 (권장):
1. Phase 1: schema 변경 + `db:deploy` (new_mes)
2. Phase 2: API route 구현 (`/api/lms/ncwatch/*`)
3. Phase 3: 설비연결설정 UI 수정 (연결유형 추가 + NCWatch 폼)
4. Phase 4: 태그 자동 생성 로직
5. Phase 6: 기존 화면 isVisible 필터 적용 (파라미터보기)
6. Phase 7: 테스트 T1~T13
