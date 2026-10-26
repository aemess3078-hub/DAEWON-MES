# 대원정밀 MES — LOT QR 라벨 출력 (Brother QL-820NWB · 29×90mm)

브랜치: `feat/daewon-qr-label-print` (기준: `origin/main` ec8314a = 안정화 PR #5 병합 후). 로컬 작업, 푸시·배포 없음.

## 1. 무엇이 바뀌었나

| 문제 | 원인 | 조치 |
|---|---|---|
| 라벨 외 화면(메뉴·발주번호·팝업 제목·버튼)이 같이 출력 | `react-to-print` 가 숨은 iframe 에서 `print()` 호출 → Android Chrome 은 iframe 이 아니라 **현재 페이지 전체**를 인쇄. 또 `globals.css` 의 `body{overflow:hidden}` 로 잘림 | 라벨만 담긴 전용 페이지 `/label-print` 를 새 탭으로 열고 **그 페이지 자체**를 인쇄 (`label-print-client.tsx`) |
| 출력 내용 겹침·잘림 | 62mm 임의 폭, `@page size:auto`, CSS 줄임 의존 | 90×29mm mm/pt 고정 치수, 글자 크기·줄 수를 계산(`label-spec.ts`)해 29mm 를 넘지 않게 함 |
| CODE128 바코드 | 레거시 | LOT QR (Phase 11 표준 `DAEWON|LOT|1|<LOT 번호>`) |

## 2. 라벨 규격

- 용지: **가로 90mm × 세로 29mm**, 라벨 1장 = 인쇄 페이지 1개, `@page { size: 90mm 29mm; margin: 0 }`
- 안쪽 여백 2mm, QR↔텍스트 간격 2mm
- 왼쪽: **QR 19mm 정사각형**(quiet zone 4모듈 포함, 오류정정 M, 벡터 SVG). 일반 LOT 번호(v2~v4) 모듈 ≈ 0.46~0.58mm
- 오른쪽(65mm): `대원정밀 · 입고일/생산일` / 품목명(최대 2줄, 11→8pt 자동 축소) / 품목코드 / `LOT <번호>`(한 줄 우선, 10→7.5pt, 최후 2줄) / `수량`
- QR 데이터: `DAEWON|LOT|1|<encodeURIComponent(LOT 번호)>` — 수량·품명 등 변하는 값은 넣지 않음. 스캔하면 서버에서 LOT 조회. 같은 LOT 는 항상 같은 QR.
- LOT 번호가 없으면 **QR 을 만들지 않고 "출력 불가" 사유 표시**(임의 식별자·CODE128 대체 없음). BATCH QR 은 설계하지 않음.
- 샘플(실제 Chrome 렌더): `docs/qr-label-samples/label-sample-{1,2,3}.png` (짧은 이름 / 긴 이름+긴 LOT / 영문 긴 이름+한글 LOT)

## 3. 출력 흐름 (`barcode-print-dialog.tsx`)

1. [인쇄] 클릭 → **클릭 직후 동기적으로 빈 탭을 연다**(모바일 Chrome 팝업 차단 방지)
2. `checkLotLabelPrintable` — Lot 행이 DB 에 영속화됐는지, 이미 출력된 LOT(재출력)인지 확인(읽기 전용)
3. 재출력이면 사유 입력 요구 (서버 이력으로 판정)
4. 라벨 job 을 localStorage 에 저장(30분 만료, 서버 경유·URL 노출 없음)
5. 기존 `onBeforePrint` (자동채번 예약 인쇄 표시)
6. `recordLotLabelPrint` — AuditLog(`LotLabel`/`CREATE`, `LABEL_PRINT`|`LABEL_REPRINT`, 사유, QR payload)
7. 새 탭이 `/label-print?job=…` 로 이동 → 폰트·QR 렌더 완료 확인 → 인쇄 창 자동 1회 호출(+[인쇄] 버튼)

화면별 적용
- **자재입고**: 입고 확정(전 품목 성공) 직후 LOT 라벨 창이 열린다. 확정 전 버튼은 *미리보기 전용*. 창을 닫으면 입고 창도 닫힘.
- **완제품/반제품 입고**: 입고 후 서버가 발번·영속화한 LOT(`res.lotNo`)로 라벨 출력(생산일).
- **출하 일괄/자재출고**: LOT QR 대상이 아니라 기존처럼 품목 바코드(CODE128). `legacyItemBarcode` 로 명시한 화면에서만 허용, 같은 90×29mm 페이지로 출력(잘림 수정 효과 동일).

## 4. 변경하지 않은 것
- `receiving.actions.ts`, `finished-goods.actions.ts`, `lot.actions.ts`, 재고/채번/멱등/advisory lock 로직 — **수정 없음**
- Phase 10~12 브랜치 병합 없음. Phase 11 에서는 `lib/qr/lot-qr.ts`(순수 파서)를 그대로, `recordLotLabelPrint` 를 현재 main 인증 구조(`requireResourcePermission`)에 맞춰 이식(`lot-label.actions.ts`). 카메라 스캔/조회(`lot-qr.actions.ts` 등)는 Phase 10 인증(`action-guards`)에 의존하므로 이번 범위에서 제외.
- 추가 의존성: `jsqr`(devDependency, QR 디코딩 테스트용). 스키마/마이그레이션 없음.

## 5. 테스트 결과 (로컬)

| 스크립트 | 결과 |
|---|---|
| `npm run test:qr-label-print` | 135 checks passed — QR 표준·왕복, jsQR 디코딩, 레이아웃 계산, LOT 없음 차단, job 검증, 서버 게이트/감사(가짜 Prisma), 소스 구조, 기존 입고 로직 보존 |
| `scripts/test-qr-label-browser.ts` (실제 Chrome, 개발 서버 필요) | 37 checks passed — 인쇄 매체에서 UI 제거, PDF 3장→3페이지·90×29mm, 회전 29×90mm, 단일 1페이지, 텍스트/QR 넘침 없음, **브라우저가 그린 QR 을 캡처해 디코딩**, 만료/무효 job 안내, 모바일 393px 폭 |
| `npx tsc --noEmit`, `npm run check:server-actions`, eslint(변경 파일) | 통과 |
| `test:daewon-stabilization-phase1` (344), `number-format`, `mrp-security`, `order-mrp-service`, `mrp-purchase-suggestion-ui` | 통과 |
| `test:report-output` T18 | **기존 실패** (원본 작업 폴더·이 변경 이전에도 동일). 이번 변경과 무관 |

DB 필요 테스트(`test-daewon-stabilization-db.ts`)와 `next build`, 로그인 후 실제 입고 화면 클릭 테스트는 실행하지 않았다.

## 6. 한계 / 현장 확인 필요 (FIELD_TEST_REQUIRED)
1. **실제 용지 출력 성공 여부는 브라우저가 알 수 없다.** 감사 기록은 "출력 요청" 시점.
2. **Android Brother Print Service Plugin 의 사용자 정의 용지 처리**: Chrome 은 `@page size` 로 90×29mm PDF 를 만들지만, 플러그인이 29×90mm 세로 롤로만 인식해 회전/축소할 수 있다. 이 경우 `/label-print` 상단 [용지 방향]을 *세로 29×90mm* 로 바꾸면(선택값 기억) 라벨 면을 90° 돌려 29×90 용지에 맞춘다.
3. DK-11201 류 절취 라벨의 **프린터 비인쇄 여백**(실제 인쇄 가능 영역)은 미확인 — QR 은 라벨 가장자리에서 2mm, 텍스트도 2mm 안쪽. 가장자리가 잘리면 `?qr=17` 처럼 QR 크기를 줄이거나 여백 상수(`LABEL_PADDING_MM`)를 조정.
4. 실제 Android 카메라 판독(권장 거리 10~20cm), 열전사 인쇄 농도에서의 0.46~0.58mm 모듈 판독은 실물로 확인.
5. 라벨 인쇄 탭은 팝업을 쓴다 — 태블릿 Chrome 에서 MES 사이트의 팝업을 허용해야 한다(차단 시 안내 메시지).
6. 자동채번이 서버 입고 시점에 번호를 정하는 LOT(화면에 번호가 없는 경우)는 입고 후 라벨을 자동으로 열 수 없다(서버 응답에 lotNo 가 없고, 입고 로직을 수정하지 않기 위함). LOT 목록 재출력 화면은 이번 범위 밖.

## 7. 현장 검증 절차
1. 태블릿 Chrome 에서 MES 로그인 → 사이트 설정에서 **팝업 허용**
2. 원자재 입고 1건 확정 → 자동으로 열린 LOT 라벨 창에서 미리보기 확인 → [인쇄]
3. 새 탭(`/label-print`)이 열리고 인쇄 창이 자동 호출됨 → 프린터 **Brother QL-820NWB (192.168.0.30)**, 용지 **29×90mm / 사용자 정의 90×29mm**, 배율 **100%(실제 크기)**, 여백 **없음**, 머리글/바닥글 끄기
4. 출력물 확인: ① 메뉴·발주번호·팝업 제목 없음 ② QR+텍스트가 겹치지 않고 잘리지 않음 ③ 라벨 1장 = 1장 절취 ④ 옆으로 누웠으면 [용지 방향] 변경 후 재인쇄
5. 출력 라벨의 QR 을 Android 카메라/스캐너로 읽어 `DAEWON|LOT|1|<LOT 번호>` 가 나오는지 확인
6. 같은 LOT 를 다시 인쇄 → 재출력 사유 입력 요구, 라벨에 "재출력" 표시, QR 은 동일한지 확인
7. 완제품 창고(192.168.0.29)에서 완제품 입고 → 생산일 라벨 반복
8. 긴 품목명·긴 LOT 샘플 1장씩, 3장 연속 출력(페이지 분리)
9. 결과(용지 방향/여백/QR 크기 조정값)를 기록해 상수에 반영
