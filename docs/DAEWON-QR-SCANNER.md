# 대원정밀 MES — 공통 카메라 QR 스캐너 (3단계)

브랜치 `feat/daewon-qr-label-types`(미커밋). 범위: **QR 인식 · 형식 검증 · 결과 반환**까지. 업무 처리(입고/출고/공정이동/재고/출하)와 업무 화면 연동은 하지 않았다.

## 구성
| 파일 | 역할 |
|---|---|
| `src/lib/qr/qr-scan-result.ts` | 스캔 결과 타입 `QrScanResult {kind, version, id, raw}` + `parseQrScan()` (기존 `parseDaewonQr` 재사용, 한국어 오류 안내) |
| `src/lib/qr/lot-qr.ts` | 기존 파서. `parseDaewonQr` 결과에 `version` **추가만**(기존 필드 불변) |
| `components/common/qr-scanner/camera-support.ts` | 카메라 사용 가능 확인(HTTPS/localhost), 오류 → 한국어 안내, 제약조건(후면 우선·1280×720), 후면 카메라 선택 보정, 마지막 카메라 기억 (순수 함수, SSR 안전) |
| `…/qr-decoder.ts` | 디코더: **BarcodeDetector(있으면) → jsQR 동적 import 폴백**, 실행 오류 시 jsQR 로 영구 전환, 프레임 640px 축소 |
| `…/use-qr-camera-scanner.ts` | 훅: 시작/정지/카메라 선택/디코딩 루프/중복 방지/자원 정리 |
| `…/qr-scanner-view.tsx` | 인라인 스캐너 화면(영상 + 스캔 영역 + 카메라 선택 + 안내 + [카메라 시작]/[닫기]) |
| `…/qr-scanner-dialog.tsx` | 대화상자 래퍼(모바일 전체 화면, 데스크톱 중앙) — **업무 화면이 쓸 진입점** |
| `/label-print/scan` | 로그인·서버·DB 없는 점검 화면 (`src/app/label-print/scan/`). 개발·점검용이라 운영 빌드에서는 기본 404 — production build 브라우저 테스트 시에만 서버에 `ENABLE_QR_DEV_PAGES=true` (`next dev` 에서는 항상 열림, `src/lib/dev-pages.ts`) |

## 사용법 (다음 단계 업무 화면)
```tsx
<QrScannerDialog open={open} onOpenChange={setOpen} onScan={(r) => { /* r.kind: "LOT"|"WIP", r.version, r.id, r.raw */ }} />
```
스캔 성공 시 `onScan` 이 **1회** 호출되고 카메라는 이미 종료된 상태다. `id` 는 신뢰할 수 없는 입력이므로 호출 화면이 서버에서 tenant/권한/상태를 다시 검증해야 한다. LOT QR 은 원자재/완제품 형식이 같아 `kind: "LOT"` 로만 돌려준다(구분은 서버 조회).

## QR 인식 방식 선택
| 후보 | 판단 |
|---|---|
| **jsQR** (선택, 이미 프로젝트 의존성) | 순수 JS, 어디서나 동작(Windows Chrome/Edge·키오스크 포함), ~130KB, 동적 import 로 스캐너를 열 때만 로드. 신규 설치 없음(`devDependencies` → `dependencies` 로 이동) |
| 브라우저 BarcodeDetector (보조) | Android Chrome 은 대체로 지원, **Windows 데스크톱 Chrome/Edge 는 미지원** → 단독 사용 불가. 있으면 사용(빠르고 저전력), 없거나 오류면 jsQR |
| html5-qrcode | 내부적으로 zxing-js 를 감싼 UI 포함 라이브러리, 번들이 크고 UI/제어 커스터마이징이 제한적, 유지보수 활발하지 않음 |
| @zxing/browser | 인식률 우수하나 번들이 크고(수백 KB) 유지보수 속도가 느림, jsQR 대비 이점이 이 용도(라벨 QR)에서 크지 않음 |

## Android / Windows 대응
- 카메라 요청: `facingMode: ideal environment`(후면 우선, 없으면 브라우저가 가능한 카메라로 대체 — PC 웹캠), 1280×720·≤30fps(저사양 보호). 전면이 열렸는데 후면 라벨 카메라가 있으면 1회 전환. 카메라가 2대 이상이면 선택 목록(선택값 기억, 사라졌으면 기본 카메라로 대체).
- 보안: HTTPS 또는 localhost 가 아니면 안내 문구(HTTP 로 접속한 키오스크/태블릿 대비).
- 정리: 성공·닫기·언마운트·탭 숨김·오류 시 모든 track `stop`. 권한 대기 중 닫아도 나중에 열린 스트림을 즉시 종료(토큰).
- 디코딩: 이전 해석이 끝난 뒤 150ms 간격으로 다음 해석(겹침 없음), 긴 변 640px 로 축소.
- UI: 모바일/세로 태블릿/낮은 가로 화면은 전체 화면, 데스크톱은 중앙 대화상자. 큰 [닫기](48px), 스캔 영역 표시, 영상은 `object-cover`(늘어남 없음).

## 검증
- `npm run test:qr-scanner` (79): QR 검증(정상 LOT/WIP, 잘못된 접두·버전·빈 식별값·BATCH 등·일반 텍스트), 오류 분류, 제약조건, 카메라 선택, jsQR 해독, 소스 구조(DB/네트워크 없음, 업무 화면 미연동).
- `scripts/test-qr-scanner-browser.ts` (110, 개발 서버 필요): 실제 Chrome + **가짜 카메라(QR 영상 파일)** — 최초 실행, 자동 인식, 중복 방지, 카메라 종료, 재실행, 5회 열고 닫기, 언마운트, 카메라 2대 선택·기억, 권한 거부/없음/사용 중/미지원/비보안 모킹, BarcodeDetector 있음/오류/미지원, 권한 대기 중 닫기, 5종 화면 크기 레이아웃.
- **미검증**: 실제 Android 기기·후면 카메라, 초점/조명/저사양 성능, Android 권한 UI, 산업용 키오스크 브라우저, 실제 라벨(열전사) 인식 거리.
