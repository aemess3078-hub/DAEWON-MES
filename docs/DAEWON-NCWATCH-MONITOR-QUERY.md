# 모니터링 최신 스냅샷 조회 개선 — 전체 이력 전송 위험 제거

브랜치: `perf/monitor-latest-snapshot` (기준: 운영 main `35541ce`) · 상태: 구현·로컬/읽기 전용 검증 완료 — **운영 배포 미승인 / 운영 DB 변경 0**
표기: **[실측]** 운영 DB 읽기 전용(SELECT, `SET TRANSACTION READ ONLY`) 결과 · **[추정]** 실측값 기반 계산 · ⛔ 미검증

## 1. 문제 확인 (운영 DB 실측)
대상: 모니터링 대상 설비 4대(태그 56개), TagSnapshot 2,240건 시점.

| 항목 | 기존 `snapshots: { orderBy, take: 1 }` | 개선(`LATERAL … LIMIT 1`) |
|---|---|---|
| 실제 SQL | `SELECT … FROM "TagSnapshot" WHERE "tagId" IN ($1…$56) ORDER BY "timestamp" DESC OFFSET $57` — **LIMIT 없음** | `unnest(tagIds) CROSS JOIN LATERAL (SELECT value,timestamp FROM "TagSnapshot" WHERE "tagId"=t.tagId ORDER BY "timestamp" DESC LIMIT 1)` |
| DB가 앱(Node)으로 보내는 행 수 | **2,240행 (전체 이력)** → Prisma가 메모리에서 태그당 1건만 남김 | **56행 (태그당 1건)** |
| 전송 크기 | ≈ 186 KiB | ≈ 6 KiB |
| 실행 계획 | Index Scan(IN) + Sort, `rows=2240`, `Buffers hit=1732` | Index Scan **Backward**, `rows=1 loops=56`, `Buffers hit=168`, 실행 0.38 ms |
| 쿼리 수 | 1 (중첩) | 1 |
| 결과 | 최신값 56개가 개선 쿼리와 **56/56 일치** | 〃 |
| 인덱스 | `TagSnapshot_tagId_timestamp_idx (tagId, timestamp)` 이미 존재 — **스키마/인덱스 변경 없음** | 〃 |

기존 폴백 `DISTINCT ON ("tagId") … WHERE tagId IN (…)` 도 실행 계획상 2,240행을 모두 읽어 중복 제거한다(`rows=2240`, 1,732 buffers, 서버 안에서만 처리되어 egress 는 작지만 DB 부하는 이력 크기에 비례).

## 2. 이력 100만 건 이상 누적 시 (추정 ⛔ 직접 실행 미검증)
로컬 PostgreSQL 이 없고 운영 DB 에 대량 데이터를 넣을 수 없어 100만 건을 직접 실행하지는 못했다. 실행 계획의 행 수로 외삽한다 (태그 56개, 태그당 ≈ 21,400행):

| | 기존 중첩 `take:1` | 개선 |
|---|---|---|
| DB→Node 전송 행 수 | 1,200,000 | **56** |
| 전송 크기/호출 | ≈ 100 MiB (186 KiB × 1.2M/2,240) | ≈ 6 KiB |
| DB 읽기 | 이력 전체를 인덱스로 읽고 정렬 | 태그당 인덱스 3~4 페이지 (O(태그 수 × log N)) |
| 30초 폴링 1탭, 하루(2,880회) | ≈ 280 GB | ≈ 17 MB |

→ 폴백 경로가 한 번이라도 상시 호출되면 CNS MEDICAL 과 같은 egress 폭증이 가능했다. 수정 후에는 이력 크기와 무관하다.

## 3. 호출 경로와 영향
| 함수 | 호출처 | 스냅샷 사용 | 변경 |
|---|---|---|---|
| `getEquipmentMonitorLive` | `/api/mes/equipment-monitor/light` (30초 폴링), 키오스크 | 현재값(`TagCurrentValue`)이 **없는** 태그만 폴백 | 폴백 쿼리를 `DISTINCT ON` → `LATERAL … LIMIT 1` |
| `getEquipmentMonitorData` | Live 의 스키마 호환 오류 폴백 | 모든 태그의 최신 스냅샷 | 중첩 `take:1` 제거 → 같은 헬퍼로 태그당 1건 |

- 신규 헬퍼: `fetchLatestSnapshotsByTag` (`equipment-monitoring.utils.ts`, "use server" 아님 → 외부 호출 불가). 입력은 서버가 테넌트 조건으로 조회한 태그 ID 뿐이다.
- 응답 형태·화면 표시는 동일 (운영 DB 로 `getEquipmentMonitorLive`/`getEquipmentMonitorData` 실행: 4대 모두 정상, STATUS=오프라인 등 값 동일, 브라우저 전송 JSON ≈ 8.2~8.5 KiB, 소요 220~444 ms).
- 스냅샷 쿼리 수: 현재값이 모두 있으면 **0회**, 없으면 1회.

## 4. 다중 접속 [추정]
- 폴링 1탭 = 30초마다 1회 = 2,880회/일. 호출당 DB 쿼리는 설비/연결/태그/현재값/이벤트/리포트 등 약 8~9회(고정), 스냅샷 폴백 0~1회(고정).
- N명 동시 접속 시 호출량은 N에 선형이지만 호출당 데이터량이 이력과 무관해져 N×(약 8 KiB JSON, DB 읽기 수 KiB)로 일정. 테스트에서 20명 동시 접속 시 호출마다 스냅샷 쿼리 1회·행 = 태그 수로 확인.
- ⛔ 실제 동시 접속자 수·Vercel Function Invocations 대시보드 값은 미확인.

## 5. 테스트 (`npm run test:monitor-latest-snapshot`, 24 단언 PASS)
정적(전체 이력 패턴 제거) · 이력 120만 건 가정에서 반환 행 = 태그 수 · 스키마 호환 경로 · 현재값 없는 태그 폴백(일부/전부/없음) · 태그 없으면 쿼리 0 · 20명 동시 접속 · 테넌트 격리(타 테넌트 태그 ID/값 미포함) + 실제 운영 DB 읽기 전용 동일성 검증(56/56).
추가 통과: `tsc`, `check:server-actions`, 설비 관련 `test:equipment-downtime-maintenance-integrity`, `equipment-result-attribution`, `kpi-report-scope-timezone-integrity`, `npm run build`.

## 6. 위험과 롤백
- 위험: raw SQL(`LATERAL`)이 Prisma 파라미터 배열 캐스트(`ARRAY[$1,…]::text[]`)에 의존 — 운영 DB(PostgreSQL, pgbouncer 트랜잭션 풀러)에서 56개 파라미터로 동작 확인. 태그가 수천 개가 되면 파라미터 한도(32k)를 고려해 분할이 필요하지만 현재 규모(56)와 무관.
- 롤백: PR revert. 스키마/데이터 영향 없음.
