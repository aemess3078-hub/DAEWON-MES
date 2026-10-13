# NCWatch Agent 설비 연동 — 개발 계획 / 영향도 분석

> 상태: **계획/분석 전용 문서 (구현 없음)**
> 작성 기준: ncwatch-agent.zip(agent.js, mapper.js, routes.js) + 현재 New MES prisma/schema, 설비 관련 화면 실측
> 핵심 방향: **기존 MES native 모델(EquipmentEvent / TagCurrentValue / TagSnapshot / ProductionResult)에 NCWatch 데이터를 채워, 기존 9개 설비 화면을 최대한 그대로 살린다.** ncwatch_* 테이블은 원본 수신/검증/재처리용 staging.

### 확정된 결정사항 (2026-06-12)

- **Q1 연결유형**: `ConnectionProtocol`에 **`NCWATCH_AGENT` 신규 추가**. (FOCAS는 CNC 직접통신 성격 → push 방식과 의미 불일치)
- **Q2 수신 방식**: **MES 수신 API + 제한키(`MES_AGENT_KEY`)**. 현장 PC의 Supabase service_role 키 방식 폐기. 에이전트는 제한키로 MES API에 push, MES가 검증 후 staging + native 저장.
- **Q3 생산실적**: `part_count`는 **태그값/참고 데이터로만 저장**, ProductionResult 자동 생성 안 함. 향후 후속과제로 **"작업지시 매칭 후 승인 기반 생산실적 반영"** 만 남김(§4-4, §10).

---

## 0. 핵심 사실 (실측 결과)

연동 설계의 전제가 되는, 코드에서 직접 확인한 사실들이다.

| # | 사실 | 근거 | 설계 영향 |
|---|------|------|-----------|
| F1 | **태그 값을 채우는 수집기(collector)가 현재 전혀 없다.** `upsertTagCurrentValue`는 정의만 되어 있고 호출처 0건, ingestion/telemetry API 라우트 없음. | `src/lib/actions/tag-current-value.actions.ts:21`, `src/app/api/**` 전수조사 | `TagSnapshot`/`TagCurrentValue`는 현재 빈 그릇. **NCWatch 동기화 로직이 이 collector 역할을 채운다.** |
| F2 | 모든 설비 표시 화면이 native 모델 4종만 읽는다. | 아래 §1 분석표 | ncwatch_* 직접 조회 없이 native 모델만 채우면 화면이 살아남. |
| F3 | `ConnectionProtocol` enum에 이미 `FOCAS`(FANUC CNC 프로토콜)·`CUSTOM` 존재. | `prisma/schema.prisma:288` | 연결유형 추가는 enum 값 추가(가산적 migration)로 가능. |
| F4 | `EquipmentEventType` = `RUN / STOP / ALARM / WARNING / MAINTENANCE`. | `prisma/schema.prisma:329` | NCWatch 상태코드를 이 5종으로 매핑(§4). |
| F5 | `DataTag`에는 `isActive`만 있고 **`isVisible`/`isEnabled`/`isPrimary`/`displayOrder` 없음.** | `prisma/schema.prisma:1707` | 태그 표시/숨김 정책 위해 **필드 추가 필요(가산적, 기본값 有)**. |
| F6 | `EquipmentConnection.gatewayId`는 **필수(non-null)** 이며 `@@unique([equipmentId, gatewayId])`. | `prisma/schema.prisma:1688` | NCWatch는 실물 게이트웨이가 없음 → **사이트별 가상 "NCWatch Agent" 게이트웨이 1건 재사용** 권장(스키마 변경 회피). |
| F7 | `EdgeGateway`에 `apiKey`(unique) 이미 존재. | `prisma/schema.prisma:1675` | 수신 API 인증키를 신규 발명하지 않고 이 구조 재활용 가능. |
| F8 | 분석/현황 모니터링의 "설비 가동률" KPI는 이벤트가 아니라 `count(status=ACTIVE)/count(total)` 단순 계산. | `equipment-monitor.actions.ts:99` | 실시간 가동률을 원하면 이 KPI 산식 별도 검토(이번 범위 밖, 리스크에 기록). |
| F9 | 분석/현황 모니터링 그리드는 설비당 **첫 active 연결의 태그 4개 + 각 태그 최신 snapshot 1건**만 표시. | `equipment-monitor.actions.ts:37-52` | NCWatch 연결이 "첫 연결"이 되도록 하거나 표시 태그(`isPrimary`) 선별 필요. |
| F10 | 에이전트는 현재 **현장 PC에서 Supabase service_role 키로 직접 upsert**(`ncwatch_status` 등). | `agent.js:10-26,52` | 보안상 지양. **MES 수신 API + 제한 키 방식으로 전환**(§F/Phase2). |

---

## 1. 산출물 ① — 메뉴별 데이터 소스 분석표

| 메뉴 | 파일 경로 | 현재 읽는 모델 | 정상 동작에 채워야 할 데이터 |
|------|-----------|----------------|------------------------------|
| 분석모니터링 | `src/app/app/mes/equipment-monitor/page.tsx` → `getEquipmentMonitorData`/`getProductionKPIs` | Equipment, EquipmentEvent(최신1), DataTag+TagSnapshot(최신1), (KPI)ProductionResult+Equipment count | EquipmentEvent, TagSnapshot/TagCurrentValue |
| 현황모니터링 | `src/app/app/lms/monitoring/status/page.tsx` (동일 actions) | 위와 동일 | 위와 동일 |
| 스마트TV현황판 | `src/app/kiosk/page.tsx` → `getEquipmentMonitorData` | 위와 동일 | 위와 동일 |
| 에러보기 | `src/app/app/lms/equipment/errors/*` → `getEquipmentErrorEvents` | **EquipmentEvent (eventType ∈ ALARM, WARNING)** | EquipmentEvent(ALARM/WARNING) |
| 파라미터보기 | `src/app/app/lms/equipment/parameters/*` → `tag-current-value.actions` | **DataTag + TagCurrentValue** | DataTag(정의) + TagCurrentValue(값) |
| 통합통계 | `src/app/app/mes/equipment-statistics/*` → `getEquipmentStatisticsData` | production=ProductionResult / errors·downtime=EquipmentEvent / workTime=ProductionResult / availability=Equipment count | **혼합**: EquipmentEvent는 채워짐, ProductionResult 의존 항목은 비음 |
| 능력 | `src/app/app/lms/statistics/capacity/*` → `getEquipmentCapacityStats` | **ProductionResult 중심** (`:552`) | ProductionResult — NCWatch만으로는 비음(§4-4 정책 결정 필요) |
| 설비연결설정 | `src/app/app/mes/equipment-connections/*` | EquipmentConnection / EdgeGateway / Equipment | (설정 데이터) — UI 수정 대상 |
| 태그사전 | `src/app/app/mes/tags/*` → `equipment-integration.actions` | DataTag (설정 CRUD) | (설정 데이터) — 필드/정책 추가 대상 |

NCWatch agent payload(실측) — `agent.js` upsert + `mapper.js` 기준:

- **status(10초)**: `machine_name, status_code, status_label, run_code/label, mode_code/label, message_code/label, filename, o_num, spindle_speed, feed_rate, pos_x/y/z, tool_number, part_count, block_number, block_tot, wcs, ratio, time_elapsed/remain/start, alive_count, alarm_code, alarm_msg, exdata, ncwatch_ts`
- **status_history**: 상태 변경 시 `status_code/label, part_count, spindle_speed, alarm_msg, changed_at`
- **report_daily(1시간)**: `report_date, run_time, run_pct, part_count, stop_time, stop_pct, manual_pct, alarm_pct, offline_pct, manual_time, alarm_time, offline_time`
- 상태코드 의미(mapper): `0 READY · 1 STOP · 2 PAUSE · 3 START · 4 OFFLINE · 5 ALARM · 6 MANUAL`

---

## 2. 산출물 ② — 수정 필요/불필요 메뉴 구분표

| 메뉴 | 수정 필요? | 최소 수정 범위 | 그대로 사용 가능 조건 | isVisible/isEnabled 적용 |
|------|-----------|----------------|------------------------|--------------------------|
| 분석모니터링 | 🟢 거의 불필요 | (선택) 표시 태그를 `isPrimary`로 선별, "마지막 수신/오프라인" 뱃지 추가 | EquipmentEvent·TagSnapshot이 채워지면 동작 | 표시 태그 선별에 isVisible/isPrimary 권장 |
| 현황모니터링 | 🟢 거의 불필요 | 위와 동일 | 위와 동일 | 동일 |
| 스마트TV현황판 | 🟢 거의 불필요 | 위와 동일(키오스크 가독성만) | 위와 동일 | 동일 |
| 에러보기 | 🟢 불필요 | 없음 | NCWatch 알람→EquipmentEvent(ALARM) 변환만 되면 동작 | 불필요 |
| 파라미터보기 | 🟡 소폭 | **isVisible 필터 한 줄 추가**(숨김 태그 제외). 현재 필터 없음. | DataTag 정의 + TagCurrentValue 값 채워지면 동작 | **필요(isVisible)** |
| 통합통계 | 🟡 분석 필요 | 코드 수정 없이도 에러/비가동 구간은 동작. 생산량/작업시간 카드가 0으로 보이는 UX 검토 | EquipmentEvent 채워지면 부분 동작 | 불필요 |
| 능력 | 🟠 정책 결정 | ProductionResult 연계 정책(§4-4) 확정 전까지 빈 화면 가능 | ProductionResult가 채워져야 동작 | 불필요 |
| 설비연결설정 | 🔴 **수정 필요** | 연결유형 분기 + NCWatch 폼 + 매핑/미매핑 표시(§6) | — | — |
| 태그사전 | 🔴 **수정 필요** | DataTag 필드 추가 + 표시/숨김/주요/순서 컬럼 + 자동생성 연계(§5) | — | **필요** |

색 범례: 🟢 데이터만 채우면 됨 · 🟡 소폭 수정 · 🟠 정책 결정 선행 · 🔴 화면/스키마 수정.

---

## 3. 산출물 ③ — Prisma 모델 추가 초안 (제안, 미적용)

> 모두 **가산적(additive)** 변경. 기존 모델 파괴 변경 없음. snake_case 매핑은 `@map`/`@@map`로 처리.

### 3.1 staging — 원본 수신/검증/재처리용

```prisma
model NcwatchStatus {                          // 기계별 "현재값" 1행 (upsert)
  id           String   @id @default(cuid())
  tenantId     String
  siteId       String?
  machineName  String   @map("machine_name")
  statusCode   Int?     @map("status_code")
  statusLabel  String?  @map("status_label")
  runCode      Int?     @map("run_code")
  modeCode     Int?     @map("mode_code")
  messageCode  Int?     @map("message_code")
  programName  String?  @map("program_name")   // FILENAME
  oNumber      String?  @map("o_number")
  spindleSpeed Int?     @map("spindle_speed")
  feedRate     Int?     @map("feed_rate")
  positionX    Decimal? @map("position_x") @db.Decimal(18,4)
  positionY    Decimal? @map("position_y") @db.Decimal(18,4)
  positionZ    Decimal? @map("position_z") @db.Decimal(18,4)
  toolNo       String?  @map("tool_no")
  partCount    Int?     @map("part_count")
  alarmCode    String?  @map("alarm_code")
  alarmMessage String?  @map("alarm_message")
  ncwatchTs    String?  @map("ncwatch_ts")
  rawPayload   Json?    @map("raw_payload")
  receivedAt   DateTime @default(now()) @map("received_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, machineName])
  @@index([machineName])
  @@map("ncwatch_status")
}

model NcwatchStatusHistory {                   // 상태 변경 이력 (append)
  id           String   @id @default(cuid())
  tenantId     String
  machineName  String   @map("machine_name")
  statusCode   Int?     @map("status_code")
  statusLabel  String?  @map("status_label")
  partCount    Int?     @map("part_count")
  spindleSpeed Int?     @map("spindle_speed")
  alarmMessage String?  @map("alarm_message")
  changedAt    DateTime @map("changed_at")
  receivedAt   DateTime @default(now()) @map("received_at")

  @@index([tenantId, machineName, changedAt])
  @@map("ncwatch_status_history")
}

model NcwatchReportDaily {                      // 일간 리포트 (upsert by 기계+일자)
  id          String   @id @default(cuid())
  tenantId    String
  machineName String   @map("machine_name")
  reportDate  DateTime @map("report_date") @db.Date
  runTime     String?  @map("run_time")
  runPct      Decimal? @map("run_pct") @db.Decimal(5,2)
  partCount   Int?     @map("part_count")
  stopPct     Decimal? @map("stop_pct") @db.Decimal(5,2)
  manualPct   Decimal? @map("manual_pct") @db.Decimal(5,2)
  alarmPct    Decimal? @map("alarm_pct") @db.Decimal(5,2)
  offlinePct  Decimal? @map("offline_pct") @db.Decimal(5,2)
  rawPayload  Json?    @map("raw_payload")
  receivedAt  DateTime @default(now()) @map("received_at")

  @@unique([tenantId, machineName, reportDate])
  @@map("ncwatch_report_daily")
}
```

### 3.2 매핑 — NCWatch 기계명 ↔ MES 설비

```prisma
model NcwatchEquipmentMapping {
  id          String   @id @default(cuid())
  tenantId    String
  siteId      String?
  machineName String   @map("machine_name")    // 외부 수집명 (예: VM960)
  equipmentId String?  @map("equipment_id")     // MES Equipment.id (미매핑 시 null 허용)
  isActive    Boolean  @default(true) @map("is_active")
  memo        String?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  equipment   Equipment? @relation(fields: [equipmentId], references: [id])

  @@unique([tenantId, machineName])             // 기계명은 테넌트 내 유일
  @@index([equipmentId])
  @@map("ncwatch_equipment_mapping")
}
```

- **연결 기준은 `equipmentId`(Equipment.id)** — 설비명/코드 문자열이 바뀌어도 매핑 유지(요구사항 충족).
- `equipmentId=null` = 미매핑. 데이터는 staging에 계속 저장, 화면에서 "미매핑"으로 노출.

### 3.3 동기화 로그 — 수신/변환 추적

```prisma
model NcwatchSyncLog {
  id           String   @id @default(cuid())
  tenantId     String
  machineName  String?  @map("machine_name")
  endpoint     String                            // "status" | "report-daily" | "heartbeat"
  result       String                            // "OK" | "UNMAPPED" | "ERROR"
  message      String?
  payloadCount Int?     @map("payload_count")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([tenantId, createdAt])
  @@map("ncwatch_sync_log")
}
```

### 3.4 기존 모델 — 추가가 필요한 필드 (DataTag, 가산적)

```prisma
// model DataTag 에 추가 (모두 기본값 있어 기존 행 안전):
isEnabled    Boolean @default(true)  @map("is_enabled")   // 동기화 시 값 갱신 여부
isVisible    Boolean @default(true)  @map("is_visible")   // 화면 표시 여부
isPrimary    Boolean @default(false) @map("is_primary")   // 주요 태그(모니터/TV 우선표시)
displayOrder Int     @default(0)     @map("display_order")
source       String? @map("source")                       // "NCWATCH" | "MODBUS" 등 출처표시(선택)
```

> `EquipmentConnection`은 **변경하지 않는다**(F6). NCWatch 연결은 protocol 값과 사이트별 가상 게이트웨이로 표현.

### 3.5 enum 변경 (가산적)

- `ConnectionProtocol`에 `NCWATCH_AGENT` 추가 검토. 또는 기존 `FOCAS` 재사용(스키마 무변경). → §9 확인질문.

---

## 4. 산출물 ④ — NCWatch payload → MES 모델 매핑표

### 4-1. 상태 → EquipmentEvent
NCWatch `status_code` → MES `EquipmentEventType`:

| status_code | NCWatch 라벨 | → EquipmentEventType | 비고 |
|-------------|--------------|----------------------|------|
| 3 | START | **RUN** | 가공 중 |
| 1 | STOP | **STOP** | |
| 2 | PAUSE | STOP | 필요 시 별도 표현 검토 |
| 0 | READY | STOP | 대기 |
| 6 | MANUAL | STOP(또는 WARNING) | 수동모드 |
| 5 | ALARM | **ALARM** | |
| 4 | OFFLINE | STOP + "오프라인" 표기 | §6 오프라인 정책과 연계 |

생성 정책: **상태 변경 시에만 새 EquipmentEvent 생성**(이전 이벤트 `endedAt` 닫고 `duration` 계산). 동일 상태 연속 수신은 무시. → 주기마다 생성하면 이벤트 폭증(§Phase5에서 비교).

### 4-2. 알람 → EquipmentEvent(ALARM)
- `alarm_code`/`alarm_message` 존재 시 `EquipmentEvent{eventType: ALARM, message: "[code] msg"}` 생성, 알람 해제 시 `endedAt` 마감.
- 에러보기는 ALARM/WARNING을 그대로 조회하므로 **추가 수정 없이 반영**.

### 4-3. 파라미터/태그값 → DataTag 기준 TagCurrentValue/TagSnapshot
`isEnabled=true`인 태그에 대해서만 upsert:

| NCWatch 필드 | tagCode | category | unit |
|--------------|---------|----------|------|
| status_label | `STATUS` | STATUS | — |
| filename | `PROGRAM_NAME` | PROCESS | — |
| pos_x/y/z | `POS_X/Y/Z` | PROCESS | mm |
| spindle_speed | `SPINDLE_SPEED` | PROCESS | rpm |
| feed_rate | `FEED_RATE` | PROCESS | mm/min |
| tool_number | `TOOL_NO` | STATUS | — |
| part_count | `PART_COUNT` | COUNTER | ea |
| alarm_code | `ALARM_CODE` | ALARM | — |
| alarm_message | `ALARM_MESSAGE` | ALARM | — |

- TagCurrentValue: 매 수신 upsert. TagSnapshot: 변경 시 또는 N초 간격으로 insert(보관량 정책 §Phase5).
- DataTag.`plcAddress`는 NCWatch에서 PLC 주소 개념이 없으므로 **컬럼 매핑 키**(예: `spindle_speed`)로 재활용하거나 고정 placeholder.

### 4-4. 리포트/통계 (⚠ 정책 결정)
- `ncwatch_report_daily`는 가동률/비가동/알람 % 중심 → **설비 가동/비가동 통계와 친화적**.
- **NCWatch `part_count`를 ProductionResult로 직접 만들지 않는다(초기).** 이유: 생산실적은 작업지시/POP 실적 기준이라 이중계상·충돌 위험. → 초기에는 **가동률·비가동·알람·파라미터만** 연동, ProductionResult 연계는 별도 의사결정.
- 따라서 통합통계의 EquipmentEvent 의존 항목(에러/비가동)은 살아나고, 생산량/작업시간/능력은 기존 작업지시·POP 데이터에 의존(현 상태 유지).

---

## 5. 산출물 ⑤ — 태그 자동 생성 정책

- **트리거**: 설비연결설정에서 NCWatch 매핑을 새로 등록(machineName ↔ equipmentId)할 때, 해당 연결에 기본 태그 세트를 자동 생성.
- **생성 대상**: payload에 실제로 존재하는 값만(§4-3 표). 예: `feed_rate`가 항상 비어오면 생성 제외 — 1차 수신 샘플 확인 후 확정.
- **중복 방지**: `@@unique([connectionId, tagCode])`로 보장. 자동생성은 "없을 때만 insert"(upsert-skip).
- **기본 표시/숨김 구분**:
  - 기본 표시(isVisible=true, isPrimary 후보): `STATUS`, `PROGRAM_NAME`, `SPINDLE_SPEED`, `PART_COUNT`, `ALARM_MESSAGE`
  - 기본 숨김(isVisible=false): `POS_X/Y/Z`, `TOOL_NO`, `FEED_RATE`, `ALARM_CODE`, block/ratio 류(상세값)
- **사용자 편집 가능 항목**: `displayName, unit, isVisible, isPrimary, displayOrder`. 자동생성 후에도 수정 가능.
- **삭제 정책**: 물리삭제 대신 `isActive=false` 비활성화 우선.
- **정책 효과**:
  - `isVisible=false` → 파라미터보기·현황모니터링·스마트TV에서 숨김.
  - `isEnabled=false` → 동기화 시 해당 태그 값 갱신 안 함(staging엔 남음).

---

## 6. 산출물 ⑥ — 설비연결설정 UI 변경안

현재 `connection-form-sheet.tsx`는 protocol watch로 Modbus/OPC-UA/MC 전용 필드를 분기 렌더(`watchedProtocol === ...`). 동일 패턴을 확장.

**연결유형(상단 선택) 추가:**
1. `NCWatch Agent`
2. `Modbus TCP / Edge Gateway` (= 기존, 보존)

**NCWatch Agent 선택 시 — 표시 필드:**
- 수집 기계명(machineName): `ncwatch_status`/`ncwatch_status_history`에서 distinct 목록 + 직접입력 허용(아직 수신 전 기계 대비)
- MES 설비: Equipment 선택(`equipmentId` 저장)
- 사용 여부(isActive)
- 메모(memo)

**NCWatch Agent 선택 시 — 숨길 필드:** 게이트웨이·프로토콜 세부·호스트IP·포트·Slave ID·Register Start/Count (= 현 Modbus 블록 비표시)

**저장 동작:**
- `NcwatchEquipmentMapping` upsert(매핑 본체).
- 내부적으로 `EquipmentConnection` 1건 생성 — protocol=NCWATCH_AGENT(또는 FOCAS), gatewayId=사이트별 가상 "NCWatch Agent" 게이트웨이(F6 회피), host/port null.
- 저장 직후 기본 태그 자동 생성(§5).

**미매핑 표시:** 연결설정 목록 상단/별도 탭에 "미매핑 수집 기계명"(staging엔 있으나 mapping 없는 machineName)을 배지로 노출 → 클릭 시 매핑 등록.

**기존 Modbus 경로 보존:** 연결유형=Modbus면 현재 폼/`buildConfig`/`parseConfig` 로직 100% 그대로. 분기만 추가, 기존 코드 경로 미변경.

---

## 7. 산출물 ⑦ — 단계별 구현 계획

| Phase | 내용 | 산출물 | 비고 |
|-------|------|--------|------|
| **0 현황분석** | 본 문서 (모델/화면/payload/collector 부재/enum 확인) | 분석문서 | ✅ 완료 |
| **1 DB설계** | staging 3 + mapping 1 + syncLog 1 모델, DataTag 5필드, enum 1값 | schema 변경안 + migration 파일 계획 | **운영 DB 직접반영 금지**, `db:deploy` 수동, Vercel build엔 migration 미포함 |
| **2 수신API** | `POST /api/lms/ncwatch/status` · `/report-daily` · `/heartbeat`. Agent key 인증, tenant/site 식별, staging 저장, syncLog | API 설계서 | 실패/중복/재처리 정책 포함 |
| **3 연결설정 수정** | 연결유형 분기, NCWatch 폼, 매핑 CRUD, 미매핑 표시 | UI/액션 변경안 | Modbus 보존 |
| **4 태그 자동생성** | 매핑 시 기본 태그 생성, 중복방지, 표시/숨김 기본값 | 로직 설계 | §5 정책 |
| **5 변환/동기화** | status→EquipmentEvent, alarm→ALARM, params→TagCurrentValue/Snapshot | 변환 서비스 설계 | 상태변경시만 이벤트 / 스냅샷 주기·보관 정책 |
| **6 화면연결확인** | 9개 화면 표시조건 검증, isVisible 필터 적용(파라미터보기 등) | 검증 체크리스트 | 최소수정 |
| **7 테스트** | 더미 payload, 미매핑, 매핑후 표시, 숨김/비활성, 알람, 오프라인 | 테스트 시나리오 | new_mes 데모 우선 |
| **8 배포/운영** | migration 생성 → `db:deploy` 수동 → new_mes 검증 → 운영 반영, 백업/롤백, 현장 PC 설정 정리 | 배포 런북 | service_role 키 제거, 제한키 전환 |

**수신 API 처리 흐름(Phase2 상세):**
```
agent → POST /api/lms/ncwatch/status (헤더: X-Agent-Key)
  1) Agent key 검증 → tenant/site 식별
  2) machineName별 ncwatch_status upsert + ncwatch_status_history insert(변경 시)
  3) NcwatchSyncLog 기록
  4) mapping(equipmentId) 있으면 → native 변환 실행(EquipmentEvent/TagCurrentValue)
     없으면 → staging만 저장, result=UNMAPPED
```

---

## 8. 산출물 ⑧ — 리스크 / 주의사항

| # | 리스크 | 영향 | 완화 |
|---|--------|------|------|
| R1 | **보안**: 현 에이전트가 현장 PC에 service_role 키 보유(DB 전권) | 키 유출 시 전체 DB 위험 | 수신 API + per-agent 제한키(`X-Agent-Key`), service_role 키 현장 제거 |
| R2 | `EquipmentConnection.gatewayId` 필수(F6) | NCWatch 연결 생성 막힘 | 사이트별 가상 게이트웨이 1건 재사용(스키마 무변경) |
| R3 | 모니터 그리드가 "첫 연결의 태그 4개"만 표시(F9) | 표시 태그가 의도와 다를 수 있음 | isPrimary/isVisible로 표시 태그 선별, 또는 조회 로직 최소수정 |
| R4 | "설비 가동률" KPI가 이벤트 기반 아님(F8) | 실시간 가동률 부정확 | 이번 범위 밖 — 별도 산식 검토 항목으로 분리 |
| R5 | `part_count`→ProductionResult 직결 시 이중계상 | 작업지시/POP 실적과 충돌 | 초기 연동 제외, 별도 의사결정(§4-4) |
| R6 | TagSnapshot 10초 적재 시 행 폭증 | 스토리지/성능 | 변경 기반 또는 N초 다운샘플 + 보관기간(retention) 정책 |
| R7 | 상태코드 매핑이 mapper.js 추정값(주석 "샘플 확인 후 보정") | 잘못된 상태 분류 | 1차 수신 샘플로 STATUS_MAP 검증 후 확정 |
| R8 | 미매핑/기계명 오타 | 데이터 유실 우려 | staging은 항상 저장, 미매핑 화면 노출 |
| R9 | DataTag 필드 추가 migration | 운영 영향 | 전부 기본값 有 가산 변경, `db:deploy` 수동·new_mes 선검증 |

**불변 제약(요구사항):** ① 지금은 구현 없음(문서만) ② `next.config.mjs` 미수정 ③ schema/migration은 계획만 ④ 운영 DB 직접반영 금지 ⑤ Modbus/Edge Gateway 기능 보존 ⑥ 기존 화면 갈아엎기 금지(native 모델 채우기 우선) ⑦ isVisible/isEnabled 필터 없는 화면은 최소수정 제안.

---

## 9. 산출물 ⑨ — 구현 전 확인 질문 목록

1. **연결유형 표현**: `ConnectionProtocol`에 `NCWATCH_AGENT` 값을 새로 추가할까요, 아니면 기존 `FOCAS`를 재사용할까요? (전자는 의미 명확/enum migration, 후자는 스키마 무변경)
2. **수신 방식**: 권장안대로 **MES 수신 API(POST) + 제한키**로 전환할까요? 아니면 당장은 에이전트의 Supabase 직접 upsert를 유지하고 MES는 staging만 읽을까요? (보안 R1 관련)
3. **생산실적**: NCWatch `part_count`를 ProductionResult로 **연계하지 않음**(초기 제외)에 동의하시나요? 능력/통합통계 생산량 카드가 당분간 기존 데이터만 반영됩니다.
4. **가동률 KPI**: 모니터링의 "설비 가동률"을 현행 단순 산식 유지할까요, NCWatch 가동상태 기반 실시간 산식으로 바꾸는 것을 별도 과제로 잡을까요? (F8/R4)
5. **테넌트/사이트**: 현장 에이전트 1대가 단일 tenant/site로 고정인가요? 여러 사이트를 한 에이전트가 보내나요? (수신 API의 site 식별 방식 결정)
6. **EquipmentConnection 가상 게이트웨이**: 사이트별 "NCWatch Agent" 게이트웨이 1건 자동 생성/재사용 방식에 동의하시나요? (R2)
7. **스냅샷 보관**: TagSnapshot 적재 주기(매 수신 vs 변경 시 vs N초)와 보관기간(예: 30/90일) 기준이 있나요? (R6)
8. **대상 환경 순서**: new_mes 데모 검증 → cns-medical-mes 운영 반영 순서가 맞나요? 두 환경의 schema 동기화 상태를 먼저 점검할까요?
9. **상태코드 검증**: 1차 수신 샘플로 `STATUS_MAP`(0~6) 실제 의미를 확정하는 절차를 Phase1 앞에 넣을까요? (R7)
