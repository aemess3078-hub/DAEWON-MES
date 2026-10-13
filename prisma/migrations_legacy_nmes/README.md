# migrations_legacy_nmes — NMES 과거 migration (보관 전용)

이 폴더는 DAEWON-MES 가 NMES 를 기반으로 만들어질 때 함께 복제된 **NMES 개발 DB 의 migration 이력**(53개)이다.

## ⚠️ 실행 금지
- **DAEWON-MES 에서는 이 migration 들을 실행하지 않는다.** Prisma 는 `prisma/migrations/` 만 읽으므로 이 폴더는 적용 대상이 아니다.
- 이력이 **`prisma db push` 로 만든 객체와 섞여 있어 빈 DB 에서 처음부터 재생할 수 없다.**
  - `20260328150000_inventory_balance_to_warehouse`: 앞선 migration 이 만든 constraint 를 `DROP INDEX` 로 지우려 해 빈 DB 에서 실패한다.
  - 테이블 6개(`NumberingRule`, `NumberingSequence`, `EquipmentProblemType`, `EquipmentRepairRequest`, `EquipmentDailyCheck`, `SupportRequest`)와
    enum 7개(`NumberingRuleType`, `RepairRequestStatus`, `RepairPriority`, `CheckResult`, `SupportType`, `SupportStatus`, `SupportPriority`)는
    어떤 migration 에서도 생성되지 않는다(`20260910000000_add_equipment_downtime_maintenance_integrity` 가 `CheckResult` 를 참조하며 실패).
- `db-migrate.legacy.js` 는 이전 `npm run db:deploy` 가 쓰던 스크립트로, 실패 시 migration 을 임의로 "적용됨"(baseline) 처리한다. 사용 금지.

## 용도
- 참고/감사용으로만 보존한다(NMES 에서 어떤 변경이 어떤 순서로 들어갔는지 확인).

## DAEWON-MES 의 기준
- `prisma/schema.prisma` 가 단일 진실 소스이다.
- `prisma/migrations/20261013000000_daewon_initial_baseline` 이 빈 DB 에서 현재 스키마 전체를 만드는 최초 migration 이다
  (`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` 로 생성).
- 이후 스키마 변경은 이 baseline 위에 새 migration 으로 추가한다.
