-- NCWatch 설비 연동 통합 마이그레이션
-- Phase 1: Staging 테이블, 매핑 테이블, 동기화 로그, DataTag 확장, ConnectionProtocol enum 추가
-- 모든 변경은 가산적(additive) — 기존 테이블/행 파괴 없음
-- 적용 환경: new_mes 개발/데모 DB 우선 (cns-medical-mes 운영은 별도 승인 후)

-- ─── 1. ConnectionProtocol enum 에 NCWATCH_AGENT 추가 ─────────────────────────
ALTER TYPE "ConnectionProtocol" ADD VALUE 'NCWATCH_AGENT';

-- ─── 2. DataTag 에 NCWatch 태그 제어 필드 추가 ──────────────────────────────────
ALTER TABLE "DataTag"
  ADD COLUMN "is_enabled"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "is_visible"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "is_primary"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "source"        TEXT;

-- ─── 3. NCWatch 기계명 ↔ MES Equipment 매핑 테이블 ────────────────────────────
CREATE TABLE "ncwatch_equipment_mapping" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "siteId"       TEXT,
    "machine_name" TEXT NOT NULL,
    "equipment_id" TEXT,
    "is_active"    BOOLEAN NOT NULL DEFAULT true,
    "memo"         TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncwatch_equipment_mapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ncwatch_equipment_mapping_tenantId_machine_name_key"
    ON "ncwatch_equipment_mapping"("tenantId", "machine_name");

CREATE INDEX "ncwatch_equipment_mapping_equipment_id_idx"
    ON "ncwatch_equipment_mapping"("equipment_id");

ALTER TABLE "ncwatch_equipment_mapping"
    ADD CONSTRAINT "ncwatch_equipment_mapping_equipment_id_fkey"
    FOREIGN KEY ("equipment_id")
    REFERENCES "Equipment"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- ─── 4. NCWatch 현재 상태 staging 테이블 (기계당 1행 upsert) ──────────────────
CREATE TABLE "ncwatch_status" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "siteId"        TEXT,
    "machine_name"  TEXT NOT NULL,
    "status_code"   INTEGER,
    "status_label"  TEXT,
    "run_code"      INTEGER,
    "mode_code"     INTEGER,
    "message_code"  INTEGER,
    "program_name"  TEXT,
    "o_number"      TEXT,
    "spindle_speed" INTEGER,
    "feed_rate"     INTEGER,
    "position_x"    DECIMAL(18,4),
    "position_y"    DECIMAL(18,4),
    "position_z"    DECIMAL(18,4),
    "tool_no"       TEXT,
    "part_count"    INTEGER,
    "block_number"  INTEGER,
    "block_tot"     INTEGER,
    "ratio"         DECIMAL(5,2),
    "alarm_code"    TEXT,
    "alarm_message" TEXT,
    "alive_count"   INTEGER,
    "ncwatch_ts"    TEXT,
    "raw_payload"   JSONB,
    "received_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncwatch_status_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ncwatch_status_tenantId_machine_name_key"
    ON "ncwatch_status"("tenantId", "machine_name");

CREATE INDEX "ncwatch_status_machine_name_idx"
    ON "ncwatch_status"("machine_name");

-- ─── 5. NCWatch 상태 변경 이력 테이블 (상태 변경 시 append) ───────────────────
CREATE TABLE "ncwatch_status_history" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "machine_name"  TEXT NOT NULL,
    "status_code"   INTEGER,
    "status_label"  TEXT,
    "part_count"    INTEGER,
    "spindle_speed" INTEGER,
    "alarm_message" TEXT,
    "changed_at"    TIMESTAMP(3) NOT NULL,
    "received_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncwatch_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ncwatch_status_history_tenantId_machine_name_changed_at_idx"
    ON "ncwatch_status_history"("tenantId", "machine_name", "changed_at");

-- ─── 6. NCWatch 일간 리포트 staging 테이블 (기계+날짜 upsert) ────────────────
CREATE TABLE "ncwatch_report_daily" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "machine_name"  TEXT NOT NULL,
    "report_date"   DATE NOT NULL,
    "run_time"      TEXT,
    "run_pct"       DECIMAL(5,2),
    "part_count"    INTEGER,
    "stop_time"     TEXT,
    "stop_pct"      DECIMAL(5,2),
    "manual_pct"    DECIMAL(5,2),
    "alarm_pct"     DECIMAL(5,2),
    "offline_pct"   DECIMAL(5,2),
    "manual_time"   TEXT,
    "alarm_time"    TEXT,
    "offline_time"  TEXT,
    "raw_payload"   JSONB,
    "received_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncwatch_report_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ncwatch_report_daily_tenantId_machine_name_report_date_key"
    ON "ncwatch_report_daily"("tenantId", "machine_name", "report_date");

-- ─── 7. NCWatch 수신/변환 로그 테이블 ─────────────────────────────────────────
CREATE TABLE "ncwatch_sync_log" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "machine_name"  TEXT,
    "endpoint"      TEXT NOT NULL,
    "result"        TEXT NOT NULL,
    "message"       TEXT,
    "payload_count" INTEGER,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncwatch_sync_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ncwatch_sync_log_tenantId_created_at_idx"
    ON "ncwatch_sync_log"("tenantId", "created_at");

CREATE INDEX "ncwatch_sync_log_result_idx"
    ON "ncwatch_sync_log"("result");
