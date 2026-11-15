# 3개월 시연 데이터 (DEMO3M) — 구성·실행·정리

> 모든 데이터는 **고객 시연용 가상 데이터**이며 실제 대원정밀 생산실적이 아닙니다.
> 대상: 로컬 매뉴얼 DB(`127.0.0.1:5432/daewon_mes_manual`, tenant `tenant-daewon-manual`) 전용. 운영 DB·원본 DAEWON-MES 와 무관.
> 기간: 2026-08-12 ~ 2026-11-11 (KST, 평일 중심, 공휴일 제외). 기준 시각 2026-11-11 17:30 이후 단계는 "진행중"으로 남김.

## 구성
| 구분 | 건수 |
|---|---|
| 케이스(완제품 생산 흐름) | 52 (PIPE 30 · PROTECTIVE CAP 14 · NON-RETURN VALVE 8) |
| 작업지시 | 82 (완제품 52 + 반제품 30), 기존 S01~S06 8건 별도 |
| 수주 | 30(생산 연결) + 13(MRP 시연, 미완료) |
| 공정 / 생산실적 | 478 / 526 (기존 포함 전체 524 / 550) |
| 품질검사 / 불량기록 / 불량수량 | 309 / 70 / 394 (기존 포함 313 / 395) |
| 구매발주 | 21(입고 완료·분할입고 포함) + 4(MRP 입고예정) |
| 출하 | 26, 외주(CAP 분체도장) 4 |

- 불량: POP 불량코드 입력 → 자주검사(QualityInspection)+DefectRecord 자동 생성. 불량이 없는 실적은 합격(PASS) 검사로 분모를 맞춤. 불량 발생일/무발생일 구분, 품목·공정별 불량률 상이, 일부 기간(PIPE 앞부분가공 9월 중순, PIPE 뒷부분가공 10월 중순, CAP 헤라시보리 10월 하순, NRV 최종검사 10월)에 불량 집중 — **시연용 패턴이며 품질개선 성과가 아님**.
- 재작업(reworkQty)은 이번 데이터에 포함하지 않음(기존 S04 에만 있음).
- MRP 시연(입고예정 반영 기준, 실제 엔진 계산): BOX 충분 · PLATE/BAR 입고예정으로 사전 해소 · PIPE-STK 12-01 결품 후 12-04 입고로 회복(일시 결품) · POWDER 입고예정 후에도 4.03KG 부족(최초 결품 12-29).
- MRP 실행이력(Snapshot)은 만들지 않았습니다(화면에서 필요 시 저장).

## 실행
```
scripts/run-demo3m.sh manual --dry-run              # 계획 수치만, DB 쓰기 없음
scripts/run-demo3m.sh manual --apply [--phase=history|mrp] [--limit=N] [--only=C001,C002]   # 멱등, 이어서 진행
scripts/run-demo3m.sh manual --verify               # 읽기 전용 검증 19항목
scripts/run-demo3m.sh test --apply|--verify         # WSL 테스트 PG(54329/daewon_mes_manual_demo3m_test)
```
`--apply` 는 `backup/daewon_mes_manual_pre-3months_*.dump` 가 없으면 중단합니다. DATABASE_URL/DIRECT_URL 이 둘 다 대상 DB 가 아니면 접속 전에 중단합니다.

## 정리(되돌리기)
- 가장 안전: 백업 `backup/daewon_mes_manual_pre-3months_20261112-131801.dump` 로 복원(시연 이후 입력한 데이터도 함께 사라짐).
- 선택 정리: `manifest-manual.json` 의 `cases`/`purchases`/`mrp` 에 기록된 수주·계획·작업지시·구매발주 ID 와 메모 태그 `[DEMO3M:…]` 로 식별. 기존 S01~S06 및 기존 LOT 는 `existing`/`baseline` 에 기록되어 보존 검증됩니다.

## 알아둘 점
- 시연 업무번호(WO/SO/PO)는 S01~S06 뒤 번호(009~)지만 일시는 과거입니다. LOT·제조번호는 월별(2608~2611)로 채번됩니다.
- 수주 생산 건은 불량만큼 생산이 모자라 수주가 "일부출하" 상태로 남을 수 있습니다(실제 출하 수량 = 완제품 입고 수량).
- NON-RETURN VALVE 공정은 대원정밀 실제 공정이 아닌 테스트용 가상 공정입니다.
- 생성 시 일시는 로컬 전용 가상 시계 + DB 시각 보정으로 과거에 맞췄습니다(`seed-manual-3months.ts` 머리말 참고).
