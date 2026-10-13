# NCWatch 연동 — Phase 1 DB 설계 초안

> 상태: **설계 확정 (schema.prisma / migration 실제 변경 없음)**
> 선행 문서: `docs/ncwatch-integration-plan.md`
> 확정 전제: Q1 `NCWATCH_AGENT` enum 추가 · Q2 수신 API + 제한키 · Q3 part_count는 태그/참고만(ProductionResult 자동생성 없음)
> 이 문서는 "무엇을 어떻게 바꿀지"의 **승인용 초안**이다. 승인 후 별도 단계에서 schema 반영 → `db:deploy` 수동 마이그레이션.

### 확정 결정사항 (2026-06-12)

**§9 잔여 질문 확정:**

1. **isActive / isEnabled 분리 확정.** 정책:
   - `isActive=false` → 태그 폐기/비활성화. 화면·동기화 대상 모두 제외.
   - `isEnabled=false` → 태그 살아있음. NCWatch 동기화 값 업데이트만 중단. 화면 표시는 isVisible에 따름.
   - `isVisible=false` → 값은 계속 수집/저장. 파라미터보기·현황모니터링·스마트TV현황판 등에서만 숨김.
   - `isPrimary=true` → 주요 모니터링 태그. 모니터 그리드 우선 표시.

2. **매핑 onDelete: SetNull 확정.** 정책:
   - `NcwatchEquipmentMapping.equipmentId` nullable 유지.
   - Equipment 삭제 시 DB relation `onDelete: SetNull` → 매핑은 존재하되 equipmentId=null(미매핑).
   - UI/서버 액션에서 매핑이 걸린 Equipment 물리삭제 시 경고 또는 차단.
   - staging 원본 데이터는 Equipment 삭제/비활성화와 무관하게 유지.
   - 매핑 끊긴 경우 화면 "미매핑" 또는 "연결 해제됨"으로 표시.

3. **적용 환경: new_mes 데모 DB 선행.** 정책:
   - Phase 1 migration은 **new_mes 개발/데모 환경에만** 적용.
   - cns-medical-mes 운영 DB는 별도 승인 후 반영.
   - Vercel build script에 migration 미포함. `db:deploy` 수동 실행.
   - 같은 저장소 공유이므로 main push 시 운영 배포 영향 별도 확인 필요.

---

## 1. 변경 요약 (한눈에)

| 구분 | 대상 | 변경 성격 | 파괴적? |
|------|------|-----------|---------|
| enum 추가 | `ConnectionProtocol`에 `NCWATCH_AGENT` | 가산 | ❌ 안전 |
| 신규 모델 | `NcwatchStatus` (staging) | 신규 | ❌ |
| 신규 모델 | `NcwatchStatusHistory` (staging) | 신규 | ❌ |
| 신규 모델 | `NcwatchReportDaily` (staging) | 신규 | ❌ |
| 신규 모델 | `NcwatchEquipmentMapping` (매핑) | 신규 | ❌ |
| 신규 모델 | `NcwatchSyncLog` (수신/변환 로그) | 신규 | ❌ |
| 필드 추가 | `DataTag`에 `isEnabled/isVisible/isPrimary/displayOrder/source` | 가산(기본값 有) | ❌ 안전 |
| 역참조 추가 | `Equipment`에 `ncwatchMappings` 관계 1줄 | 가산 | ❌ |
| **무변경** | `EquipmentConnection`, `EdgeGateway`, `EquipmentEvent`, `TagSnapshot`, `TagCurrentValue` | — | — |

> 모든 변경이 **가산적(additive)** 이라 기존 행/기능에 파괴 영향 없음. DataTag 추가 필드는 전부 `@default` 보유 → 기존 행 백필 불필요.

---

## 2. enum 변경

```prisma
enum ConnectionProtocol {
  OPC_UA
  MODBUS_TCP
  MQTT
  MC_PROTOCOL
  S7
  FOCAS
  CUSTOM
  NCWATCH_AGENT   // ← 추가 (Q1)
}
```

- Postgres enum 값 추가 = `ALTER TYPE ... ADD VALUE`. **비파괴**.
- 주의: 일부 Postgres 버전에서 `ADD VALUE`는 같은 트랜잭션 내 즉시 사용 불가. Prisma 마이그레이션이 이를 별도 구문으로 처리하므로 일반적으로 문제 없으나, migrate 후 새 값을 쓰는 시드/코드는 **마이그레이션 적용 완료 후** 실행.

---

## 3. 신규 모델 (staging — 원본 수신/검증/재처리)

> payload 근거: `agent.js` upsert 컬럼 + `mapper.js` 정규화. 필드는 1차 수신 샘플 확인 후 미세 보정 가능(특히 status 코드 의미, report DATA_n 매핑).

### 3.1 NcwatchStatus — 기계별 현재값 1행(upsert)

```prisma
model NcwatchStatus {
  id           String   @id @default(cuid())
  tenantId     String
  siteId       String?
  machineName  String   @map("machine_name")     // 예: VM960

  statusCode   Int?     @map("status_code")       // 0~6 (mapper STATUS_MAP)
  statusLabel  String?  @map("status_label")
  runCode      Int?     @map("run_code")
  modeCode     Int?     @map("mode_code")
  messageCode  Int?     @map("message_code")

  programName  String?  @map("program_name")      // FILENAME
  oNumber      String?  @map("o_number")
  spindleSpeed Int?     @map("spindle_speed")
  feedRate     Int?     @map("feed_rate")
  positionX    Decimal? @map("position_x") @db.Decimal(18, 4)
  positionY    Decimal? @map("position_y") @db.Decimal(18, 4)
  positionZ    Decimal? @map("position_z") @db.Decimal(18, 4)
  toolNo       String?  @map("tool_no")
  partCount    Int?     @map("part_count")
  blockNumber  Int?     @map("block_number")
  blockTot     Int?     @map("block_tot")
  ratio        Decimal? @map("ratio") @db.Decimal(5, 2)

  alarmCode    String?  @map("alarm_code")
  alarmMessage String?  @map("alarm_message")
  aliveCount   Int?     @map("alive_count")

  ncwatchTs    String?  @map("ncwatch_ts")         // NCWatch측 타임스탬프(문자열 그대로 보존)
  rawPayload   Json?    @map("raw_payload")         // 원본 전체 보존(재처리/디버그)
  receivedAt   DateTime @default(now()) @map("received_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, machineName])
  @@index([machineName])
  @@map("ncwatch_status")
}
```

- `@@unique([tenantId, machineName])` → 기계별 1행 upsert.
- `rawPayload`에 원본 보존 → 매핑/변환 규칙이 바뀌어도 재처리 가능.

### 3.2 NcwatchStatusHistory — 상태 변경 이력(append)

```prisma
model NcwatchStatusHistory {
  id           String   @id @default(cuid())
  tenantId     String
  machineName  String   @map("machine_name")
  statusCode   Int?     @map("status_code")
  statusLabel  String?  @map("status_label")
  partCount    Int?     @map("part_count")
  spindleSpeed Int?     @map("spindle_speed")
  alarmMessage String?  @map("alarm_message")
  changedAt    DateTime @map("changed_at")          // NCWatch 상태변경 시각
  receivedAt   DateTime @default(now()) @map("received_at")

  @@index([tenantId, machineName, changedAt])
  @@map("ncwatch_status_history")
}
```

### 3.3 NcwatchReportDaily — 일간 리포트(기계+일자 upsert)

```prisma
model NcwatchReportDaily {
  id          String   @id @default(cuid())
  tenantId    String
  machineName String   @map("machine_name")
  reportDate  DateTime @map("report_date") @db.Date

  runTime     String?  @map("run_time")             // 원본 문자열(HH:MM:SS 형태 가능)
  runPct      Decimal? @map("run_pct")   @db.Decimal(5, 2)
  partCount   Int?     @map("part_count")
  stopTime    String?  @map("stop_time")
  stopPct     Decimal? @map("stop_pct")  @db.Decimal(5, 2)
  manualPct   Decimal? @map("manual_pct") @db.Decimal(5, 2)
  alarmPct    Decimal? @map("alarm_pct")  @db.Decimal(5, 2)
  offlinePct  Decimal? @map("offline_pct") @db.Decimal(5, 2)
  manualTime  String?  @map("manual_time")
  alarmTime   String?  @map("alarm_time")
  offlineTime String?  @map("offline_time")

  rawPayload  Json?    @map("raw_payload")
  receivedAt  DateTime @default(now()) @map("received_at")

  @@unique([tenantId, machineName, reportDate])
  @@map("ncwatch_report_daily")
}
```

---

## 4. 신규 모델 — 매핑 / 로그

### 4.1 NcwatchEquipmentMapping — 기계명 ↔ Equipment.id

```prisma
model NcwatchEquipmentMapping {
  id          String   @id @default(cuid())
  tenantId    String
  siteId      String?
  machineName String   @map("machine_name")         // 외부 수집명 (VM960)
  equipmentId String?  @map("equipment_id")          // MES Equipment.id (미매핑 시 null)
  isActive    Boolean  @default(true) @map("is_active")
  memo        String?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  equipment   Equipment? @relation("EquipmentNcwatchMappings", fields: [equipmentId], references: [id])

  @@unique([tenantId, machineName])                  // 테넌트 내 기계명 유일
  @@index([equipmentId])
  @@map("ncwatch_equipment_mapping")
}
```

설계 포인트:
- **연결 기준은 `equipmentId`(Equipment.id)** — 설비명/코드 문자열 변경에도 매핑 불변(요구사항 충족).
- `equipmentId` **nullable** — 미매핑 기계의 데이터도 staging에 저장하고 화면에서 "미매핑" 노출.
- `onDelete` 미지정(기본 `Restrict`) → 매핑이 걸린 Equipment 삭제 차단. 운영상 Equipment는 "사용중지(status)" 위주이므로 안전. (정책상 SetNull 원하면 §9 질문)

### 4.2 NcwatchSyncLog — 수신/변환 추적

```prisma
model NcwatchSyncLog {
  id           String   @id @default(cuid())
  tenantId     String
  machineName  String?  @map("machine_name")
  endpoint     String                                // "status" | "report-daily" | "heartbeat"
  result       String                                // "OK" | "UNMAPPED" | "ERROR"
  message      String?
  payloadCount Int?     @map("payload_count")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([tenantId, createdAt])
  @@index([result])
  @@map("ncwatch_sync_log")
}
```

---

## 5. 기존 모델 수정 (가산적)

### 5.1 DataTag — 표시/수집 제어 필드 추가

```prisma
model DataTag {
  // ... 기존 필드 유지 ...
  isActive     Boolean  @default(true)

  // ▼ 추가 (모두 기본값 → 기존 행 백필 불필요)
  isEnabled    Boolean  @default(true)  @map("is_enabled")    // 동기화 시 값 갱신 여부
  isVisible    Boolean  @default(true)  @map("is_visible")    // 화면 표시 여부
  isPrimary    Boolean  @default(false) @map("is_primary")    // 주요 태그(모니터/TV 우선)
  displayOrder Int      @default(0)     @map("display_order")
  source       String?  @map("source")                        // "NCWATCH" | "MODBUS" 등 출처

  // ... 기존 relation/index 유지 ...
}
```

- `isActive` vs `isEnabled` 역할 구분:
  - `isActive` = 태그 자체의 사용/폐기(기존 의미, 비활성=폐기).
  - `isEnabled` = 활성 태그 중 **동기화 갱신 ON/OFF**(일시 중단용).
  - 단순화 원하면 `isActive`만으로 동기화 게이트 처리하고 `isEnabled` 생략 가능 → §9 질문.

### 5.2 Equipment — 역참조 1줄 추가

```prisma
model Equipment {
  // ... 기존 relation 목록에 추가 ...
  ncwatchMappings NcwatchEquipmentMapping[] @relation("EquipmentNcwatchMappings")
}
```

> Prisma 관계 규칙상 `NcwatchEquipmentMapping.equipment`(다대일)의 반대편 역참조가 필요해 추가하는 1줄. DB 컬럼 변화 없음(관계 메타데이터).

---

## 6. native 변환 시 사용하는 기존 모델 (참고 — 변경 없음)

변환 로직(Phase 5)이 기록할 대상. **스키마 수정 없음**, 기존 구조에 행만 추가.

| 변환 목적 | 대상 모델 | 비고 |
|-----------|-----------|------|
| 상태(가동/정지/알람) | `EquipmentEvent` (`eventType`, `startedAt`, `endedAt`, `duration`) | 열린 이벤트(`endedAt=null`) 1건 유지, 상태변경 시 마감 후 신규 |
| 알람 | `EquipmentEvent` (ALARM/WARNING) | 에러보기가 그대로 조회 |
| 파라미터 현재값 | `TagCurrentValue` (`@@unique tagId`) | upsert |
| 파라미터 이력 | `TagSnapshot` | 변경/주기 기반 insert (보관정책 Phase5) |

> `EquipmentEvent.duration`(Int, 초)은 기존 에러보기가 활용(`equipment-statistics.actions.ts:430`). 변환 시 `endedAt-startedAt`로 채워주면 통계/에러보기 그대로 동작.

---

## 7. 마이그레이션 계획 (실행은 승인 후 별도 단계)

> 메모리 기준: **build와 migrate 분리**, 운영 반영은 `db:deploy`(=`node scripts/db-migrate.js`) 수동. Vercel build script에 migration 미포함. 현 datasource는 `DATABASE_URL` 단일(직접/풀러 분기 운영 관행 확인 필요).

권장 순서:
1. `schema.prisma` 변경(enum/모델/필드) — **로컬에서만**.
2. `prisma migrate dev --name add_ncwatch_integration` (로컬 dev DB) → 마이그레이션 SQL 생성·검토.
3. 생성 SQL 점검 포인트:
   - `ALTER TYPE "ConnectionProtocol" ADD VALUE 'NCWATCH_AGENT';` (별도 트랜잭션 처리 확인)
   - 신규 테이블 5개 `CREATE TABLE` + 인덱스/유니크
   - `ALTER TABLE "DataTag" ADD COLUMN ... DEFAULT ...` 5개 (기본값 포함 → 잠금 짧음)
4. **new_mes 데모 환경 먼저** `db:deploy`로 반영 → §검증.
5. 검증 통과 후 **cns-medical-mes 운영** 반영(백업 후, §8).

마이그레이션 안전성:
- 전부 가산적이라 다운타임/락 리스크 낮음. 단 `DataTag` 컬럼 추가는 테이블 규모에 비례 — 현재 DataTag 데이터량 적어 영향 미미.
- 롤백: 신규 테이블 DROP / DataTag 컬럼 DROP / enum 값은 Postgres에서 제거 어려움(되돌리려면 타입 재생성) → **enum 추가는 사실상 비가역**, 신중. 단 미사용 enum 값은 무해.

---

## 8. 운영 반영 / 백업·롤백

- 운영 반영 전 **DB 스냅샷/백업** 확보(Supabase 백업 또는 `pg_dump`).
- 롤백 시나리오:
  - 신규 5개 테이블·DataTag 5컬럼 → DROP 가능(데이터 손실은 staging/로그뿐, native 모델 미변경이라 안전).
  - `NCWATCH_AGENT` enum 값 → 잔존 무해(사용 연결 없으면). 강제 제거 비권장.
- new_mes ↔ cns-medical-mes **schema drift 점검 선행**(두 환경 마이그레이션 이력 동기화 상태 확인).

---

## 9. Phase 1에서 결정 필요한 잔여 질문

1. **`isEnabled` 분리 vs 단일화**: `isActive`(폐기) 외에 `isEnabled`(동기화 일시중단)를 별도로 둘까요, 아니면 `isActive` 하나로 통합할까요?
2. **매핑 onDelete 정책**: 매핑된 Equipment 삭제를 차단(Restrict, 기본)할까요, 매핑을 끊고 미매핑화(SetNull)할까요? (운영은 보통 사용중지라 Restrict로 충분 추정)
3. **staging 보관기간**: `NcwatchStatusHistory`/`NcwatchSyncLog` retention(예: 90일) 정책 필요 여부 — Phase 5 스냅샷 정책과 함께 결정.
4. **siteId 필수화 시점**: 초기엔 `siteId` nullable로 두고, 수신 API에서 tenant/site 확정 후 채우는 방식으로 갑니다(에이전트가 단일 site면 추후 not-null 강화 가능). 동의하시나요?
5. **DATABASE_URL 단일/분기**: 현 schema는 directUrl 없이 `DATABASE_URL` 단일. 운영 마이그레이션 시 pgbouncer(6543) 경유 이슈가 있었던 이력(메모리) 고려해 migrate 전용 직결 URL을 임시 사용할지 확인.

---

## 10. 후속 과제(범위 밖, 기록만)

- **생산실적 연계(Q3 확장)**: NCWatch `part_count`를 작업지시와 매칭 → **사용자 승인 기반으로만** ProductionResult 반영하는 별도 기능. POP/작업지시 실적과의 이중계상 방지 로직이 핵심. 초기 범위 제외.
- **실시간 가동률 KPI 재산정**: 모니터링 "설비 가동률"을 Equipment.status count → EquipmentEvent 기반 실시간 산식으로 전환(별도 과제, plan §R4).
- **report_daily DATA_n 정밀 매핑**: 월간(DATA_1~33)·주간 리포트 연동은 1차 일간 검증 후 확장.

---

## 다음 단계

위 §9 잔여 질문(특히 1·2) 확정 후 → **Phase 2 수신 API 설계**(엔드포인트 스키마, `MES_AGENT_KEY` 검증, tenant/site 식별, 중복/재처리 정책)로 진행.
실제 `schema.prisma`/migration 반영은 본 초안 + §9 확정 후 별도 승인 단계에서 수행.
