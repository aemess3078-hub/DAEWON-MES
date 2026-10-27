/**
 * 공통 카메라 QR 스캐너 단위 테스트 — 카메라/브라우저/DB 없음.
 *
 *  A. QR 데이터 검증(parseQrScan): 정상 LOT/WIP, 잘못된 접두/버전/빈 식별값/지원하지 않는 종류/일반 텍스트/잘못된 데이터
 *  B. 스캔 결과 구조(종류·버전·식별값·원본) · LOT 는 원자재/완제품을 구분하지 않음 · 기존 파서 재사용
 *  C. 카메라 지원 확인 · 오류 분류(한국어 메시지) · 제약조건(후면 우선·과도한 해상도 회피) · 카메라 선택 휴리스틱
 *  D. 디코더: 프레임 크기 축소, jsQR 로 LOT/WIP QR 해독
 *  E. 소스 구조: DB/서버 액션/네트워크 호출 없음, 업무 화면 미연동, 신규 QR 규격 없음, 정리(cleanup) 코드 존재
 *
 * 실제 카메라/브라우저 동작(권한, 스트림 해제, 재실행, 모바일 레이아웃)은 scripts/test-qr-scanner-browser.ts 가
 * Chrome 가짜 카메라와 API 모킹으로 검증한다. 실제 Android 기기·실제 카메라는 현장 확인 대상이다.
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import Module from "node:module"
import jsQR from "jsqr"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

const lot = require("../src/lib/qr/lot-qr") as typeof import("../src/lib/qr/lot-qr")
const scan = require("../src/lib/qr/qr-scan-result") as typeof import("../src/lib/qr/qr-scan-result")
const support = require("../src/components/common/qr-scanner/camera-support") as typeof import("../src/components/common/qr-scanner/camera-support")
const decoder = require("../src/components/common/qr-scanner/qr-decoder") as typeof import("../src/components/common/qr-scanner/qr-decoder")
const svg = require("../src/lib/qr/qr-svg") as typeof import("../src/lib/qr/qr-svg")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepEqual(actual, expected, label)
  passed += 1
  console.log(`PASS ${label}`)
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

// ─── A. QR 데이터 검증 ────────────────────────────────────────────────────────
const lotQr = lot.encodeLotQr("CNS-RM-20261027-001")
const wipQr = lot.encodeWipQr("cmk3x9q2a0001abcd1234wxyz")
const okLot = scan.parseQrScan(lotQr)
const okWip = scan.parseQrScan(wipQr)
ok(okLot.ok && okLot.result.kind === "LOT" && okLot.result.id === "CNS-RM-20261027-001" && okLot.result.version === 1, "A1 정상 LOT QR → kind LOT · 버전 1 · 식별값")
ok(okWip.ok && okWip.result.kind === "WIP" && okWip.result.id === "cmk3x9q2a0001abcd1234wxyz" && okWip.result.version === 1, "A2 정상 WIP QR → kind WIP · 버전 1 · 식별값")

const bad: Array<[string, string, string]> = [
  ["A3 잘못된 접두어", "FOO|LOT|1|X1", "WRONG_PREFIX"],
  ["A4 잘못된 버전(LOT)", "DAEWON|LOT|9|X1", "UNSUPPORTED_VERSION"],
  ["A5 잘못된 버전(WIP)", "DAEWON|WIP|2|X1", "UNSUPPORTED_VERSION"],
  ["A6 빈 식별값(LOT)", "DAEWON|LOT|1|", "INVALID_IDENTIFIER"],
  ["A7 빈 식별값(WIP)", "DAEWON|WIP|1|", "INVALID_IDENTIFIER"],
  ["A8 지원하지 않는 종류(BATCH)", "DAEWON|BATCH|1|X1", "UNSUPPORTED_ENTITY"],
  ["A9 지원하지 않는 종류(SHIPMENT)", "DAEWON|SHIPMENT|1|X1", "UNSUPPORTED_ENTITY"],
  ["A10 일반 텍스트", "HELLO WORLD", "MALFORMED"],
  ["A11 구분자 부족", "DAEWON|LOT|1", "MALFORMED"],
  ["A12 구분자 과다", "DAEWON|LOT|1|A|B", "MALFORMED"],
  ["A13 빈 문자열", "", "EMPTY"],
  ["A14 공백만", "   ", "EMPTY"],
  ["A15 숫자가 아닌 버전", "DAEWON|LOT|x|X1", "MALFORMED"],
  ["A16 깨진 인코딩 식별값", "DAEWON|LOT|1|%E0%A4%A", "INVALID_IDENTIFIER"],
  ["A17 너무 긴 값", `DAEWON|LOT|1|${"A".repeat(400)}`, "TOO_LONG"],
  ["A18 제어문자 식별값", "DAEWON|WIP|1|A%0AB", "INVALID_IDENTIFIER"],
]
for (const [label, input, code] of bad) {
  const r = scan.parseQrScan(input)
  ok(!r.ok && r.code === code && r.message.length > 0 && /[가-힣]/.test(r.message) && r.raw === input, `${label} → 거부(${code}) · 한국어 안내`)
}
ok(!scan.parseQrScan(null).ok && !scan.parseQrScan(undefined).ok && !scan.parseQrScan(123).ok && !scan.parseQrScan({}).ok, "A19 문자열이 아닌 입력(null/undefined/숫자/객체)은 거부")
ok(Object.keys(scan.QR_SCAN_ERROR_MESSAGES).length === 7 && Object.values(scan.QR_SCAN_ERROR_MESSAGES).every((m) => /[가-힣]/.test(m)), "A20 모든 오류 코드에 한국어 안내 문구")

// ─── B. 결과 구조 ──────────────────────────────────────────────────────────────
eq(okLot.ok ? Object.keys(okLot.result).sort() : [], ["id", "kind", "raw", "version"], "B1 스캔 결과 필드: kind · version · id · raw 뿐")
ok(okLot.ok && okLot.result.raw === lotQr && okWip.ok && okWip.result.raw === wipQr, "B2 원본 QR 문자열을 가공 없이 그대로 돌려준다")
const encoded = scan.parseQrScan(lot.encodeLotQr("LOT 01/02#A+B&C%D"))
ok(encoded.ok && encoded.result.id === "LOT 01/02#A+B&C%D" && encoded.result.raw === "DAEWON|LOT|1|LOT%2001%2F02%23A%2BB%26C%25D", "B3 특수문자 식별값은 디코딩된 값을 id 로, 원본은 인코딩된 그대로 raw 로")
const raw1 = scan.parseQrScan(lot.encodeLotQr("RM-1"))
const fg1 = scan.parseQrScan(lot.encodeLotQr("FG-20261027-0001"))
ok(raw1.ok && fg1.ok && raw1.result.kind === "LOT" && fg1.result.kind === "LOT" && !("itemType" in raw1.result), "B4 원자재/완제품 LOT 는 같은 kind(LOT) — QR 문자열로 원자재·완제품을 구분하지 않는다")
const viaTrim = scan.parseQrScan(`  ${lotQr}\n`)
ok(viaTrim.ok && viaTrim.result.id === "CNS-RM-20261027-001", "B5 앞뒤 공백/개행(스캐너 입력 잡음)은 기존 파서가 정리한다")
const p = lot.parseDaewonQr(lotQr)
ok(p.ok && p.entity === "LOT" && p.version === 1 && lot.parseLotQr(lotQr).ok && lot.parseWipQr(wipQr).ok, "B6 기존 파서(parseLotQr/parseWipQr/parseDaewonQr) 재사용 — parseDaewonQr 에는 version 만 추가(기존 필드 유지)")
ok(lot.encodeLotQr("A") === "DAEWON|LOT|1|A" && lot.encodeWipQr("A") === "DAEWON|WIP|1|A", "B7 QR 규격 불변: DAEWON|LOT|1|… / DAEWON|WIP|1|…")
ok(lot.classifyScanInput(wipQr).kind === "INVALID" && lot.classifyScanInput(lotQr).kind === "LOT_QR", "B8 기존 스캔 입력 분류(classifyScanInput)는 변경 없음")

// ─── C. 카메라 지원 · 오류 · 제약조건 ──────────────────────────────────────────
ok(support.checkCameraSupport({ isSecureContext: false, mediaDevices: undefined })?.code === "INSECURE_CONTEXT", "C1 HTTP(비보안) → 보안 연결 안내")
ok(support.checkCameraSupport({ isSecureContext: true, mediaDevices: undefined })?.code === "UNSUPPORTED" && support.checkCameraSupport({ isSecureContext: true, mediaDevices: null })?.code === "UNSUPPORTED", "C2 mediaDevices 없음 → 브라우저 미지원")
ok(support.checkCameraSupport({ isSecureContext: true, mediaDevices: {} })?.code === "UNSUPPORTED", "C3 getUserMedia 없음 → 브라우저 미지원")
ok(support.checkCameraSupport({ isSecureContext: true, mediaDevices: { getUserMedia() {} } }) === null && support.checkCameraSupport({ mediaDevices: { getUserMedia() {} } }) === null, "C4 HTTPS/localhost + getUserMedia → 사용 가능")
const errCases: Array<[string, string]> = [
  ["NotAllowedError", "PERMISSION_DENIED"], ["PermissionDeniedError", "PERMISSION_DENIED"], ["SecurityError", "PERMISSION_DENIED"],
  ["NotFoundError", "NO_CAMERA"], ["DevicesNotFoundError", "NO_CAMERA"], ["OverconstrainedError", "NO_CAMERA"],
  ["NotReadableError", "CAMERA_BUSY"], ["TrackStartError", "CAMERA_BUSY"], ["AbortError", "CAMERA_BUSY"],
  ["TypeError", "UNSUPPORTED"], ["WhateverError", "START_FAILED"],
]
for (const [name, code] of errCases) {
  const info = support.mapCameraError({ name })
  ok(info.code === code && /[가-힣]/.test(info.message), `C5 ${name} → ${code} (한국어 안내)`)
}
ok(support.mapCameraError(null).code === "START_FAILED" && support.mapCameraError("x").code === "START_FAILED", "C6 알 수 없는 오류 값도 안전하게 처리")
ok(support.isOverconstrainedError({ name: "OverconstrainedError" }) && !support.isOverconstrainedError({ name: "NotAllowedError" }), "C7 Overconstrained 판별(선택 카메라 사라짐 → 기본 카메라 재시도)")
const defaultC = support.buildVideoConstraints() as { audio: boolean; video: Record<string, unknown> }
ok(defaultC.audio === false && JSON.stringify(defaultC.video.facingMode) === '{"ideal":"environment"}' && !("deviceId" in defaultC.video), "C8 기본 제약: 후면 카메라 우선(facingMode ideal environment) · 오디오 없음")
const exactC = support.buildVideoConstraints({ deviceId: "cam-2" }) as { video: Record<string, unknown> }
ok(JSON.stringify(exactC.video.deviceId) === '{"exact":"cam-2"}' && !("facingMode" in exactC.video), "C9 선택 카메라는 deviceId exact 로 지정")
const dims = defaultC.video as { width: { ideal: number }; height: { ideal: number }; frameRate: { max: number } }
ok(dims.width.ideal <= 1280 && dims.height.ideal <= 720 && dims.frameRate.max <= 30, "C10 과도한 해상도/프레임율을 요구하지 않는다(1280×720, ≤30fps)")
const cams = [
  { deviceId: "f", label: "Front Camera" },
  { deviceId: "b", label: "Back Camera" },
  { deviceId: "w", label: "Integrated Webcam" },
]
ok(support.pickPreferredBackCamera(cams, { deviceId: "f" }) === "b", "C11 전면이 열렸고 후면이 있으면 후면으로 전환")
ok(support.pickPreferredBackCamera(cams, { deviceId: "b" }) === null && support.pickPreferredBackCamera(cams, { deviceId: "w" }) === null, "C12 후면/웹캠이 열렸으면 전환하지 않는다")
ok(support.pickPreferredBackCamera([{ deviceId: "f", label: "전면 카메라" }, { deviceId: "r", label: "후면 카메라" }], { deviceId: "f" }) === "r", "C13 한국어 라벨(전면/후면)도 인식")
ok(support.pickPreferredBackCamera([{ deviceId: "f", label: "Front" }], { deviceId: "f" }) === null, "C14 후면이 없으면 현재 카메라로 대체(전환 없음)")
ok(support.pickPreferredBackCamera([{ deviceId: "x", label: "" }, { deviceId: "y", label: "" }], { deviceId: "x", facingMode: "user" }) === null, "C15 라벨이 없으면(권한 전) 추측하지 않는다")
const memory = new Map<string, string>()
const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) }
support.savePreferredCamera(storage, "cam-9")
ok(support.readPreferredCamera(storage) === "cam-9", "C16 마지막 선택 카메라 기억")
support.savePreferredCamera(storage, null)
ok(support.readPreferredCamera(storage) === null && support.readPreferredCamera(null) === null, "C17 선택 해제/저장소 없음 처리")
ok(support.readPreferredCamera({ getItem() { throw new Error("denied") } }) === null, "C18 저장소 오류(비공개 모드)는 무시")

// ─── D. 디코더 ────────────────────────────────────────────────────────────────
eq(decoder.fitDecodeSize(1280, 720), { width: 640, height: 360 }, "D1 1280×720 프레임은 긴 변 640 으로 축소(비율 유지)")
eq(decoder.fitDecodeSize(480, 320), { width: 480, height: 320 }, "D2 이미 작은 프레임은 그대로")
eq(decoder.fitDecodeSize(720, 1280), { width: 360, height: 640 }, "D3 세로 영상도 비율 유지")
eq(decoder.fitDecodeSize(0, 0), { width: 0, height: 0 }, "D4 빈 프레임 처리")
for (const [name, payload] of [["LOT", lotQr], ["WIP", wipQr]] as const) {
  const data = svg.buildQrSvgData(payload)
  const img = svg.renderQrRgba(data, 8)
  const decoded = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })
  ok(decoded?.data === payload, `D5 jsQR(반전 시도 없음)로 ${name} QR 해독`)
  const parsed = scan.parseQrScan(decoded?.data)
  ok(parsed.ok && parsed.result.kind === name, `D6 해독 결과 → 스캔 결과 종류 ${name}`)
}
// 640px 로 줄인 프레임(실제 디코딩 크기)에서도 해독: QR 을 영상 크기 640×480 안에 약 300px 로 배치
{
  const data = svg.buildQrSvgData(lotQr)
  const frame = svg.renderQrRgba(data, 8)
  const W = 640
  const H = 480
  const canvas = new Uint8ClampedArray(W * H * 4).fill(255)
  const target = 300
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      const sx = Math.floor((x * frame.width) / target)
      const sy = Math.floor((y * frame.height) / target)
      const si = (sy * frame.width + sx) * 4
      const di = ((y + 90) * W + (x + 170)) * 4
      canvas[di] = frame.data[si]
      canvas[di + 1] = frame.data[si + 1]
      canvas[di + 2] = frame.data[si + 2]
    }
  }
  ok(jsQR(canvas, W, H, { inversionAttempts: "dontInvert" })?.data === lotQr, "D7 640×480 프레임 중앙의 QR(약 300px)을 해독")
  ok(jsQR(new Uint8ClampedArray(W * H * 4).fill(255), W, H) === null, "D8 QR 이 없는 프레임은 null(오류 아님)")
}

// ─── E. 소스 구조 ──────────────────────────────────────────────────────────────
const scannerFiles = walk(join(process.cwd(), "src/components/common/qr-scanner")).concat([join(process.cwd(), "src/lib/qr/qr-scan-result.ts")])
const scannerSrc = scannerFiles.map((f) => readFileSync(f, "utf8")).join("\n")
ok(!/prisma|@\/lib\/db|fetch\(|XMLHttpRequest|axios|use server|actions\//.test(scannerSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "E1 스캐너는 DB·서버 액션·네트워크 호출을 하지 않는다(코드 기준)")
const testPage = read("src/app/label-print/scan/scan-test-client.tsx")
ok(!/fetch\(|@\/lib\/actions|use server|prisma/.test(testPage), "E2 테스트 화면도 서버/DB/업무 API 를 호출하지 않는다")
const businessScreens = walk(join(process.cwd(), "src/app/app")).concat(walk(join(process.cwd(), "src/app/pop")), walk(join(process.cwd(), "src/app/kiosk"))).filter((f) => /\.(tsx?|ts)$/.test(f))
const offenders = businessScreens.filter((f) => /qr-scanner|use-qr-camera-scanner|QrScannerDialog|QrScannerView/.test(readFileSync(f, "utf8")))
ok(offenders.every((f) => f.replace(/\\/g, "/").includes("/src/app/app/mes/material-issue/")) && offenders.length >= 1, `E3 업무 화면(app/pop/kiosk ${businessScreens.length}개 파일) 중 스캐너 연결은 4-1단계의 자재출고(material-issue) 화면뿐이다(${offenders.length}개 파일)`)
ok(!/DAEWON\|(BATCH|SHIPMENT|MOVE)/.test(read("src/lib/qr/qr-scan-result.ts")) && !/encode[A-Z]\w*Qr/.test(read("src/lib/qr/qr-scan-result.ts")), "E4 새 QR 규격/인코더를 만들지 않는다(기존 파서만 사용)")
ok(read("src/lib/qr/qr-scan-result.ts").includes("parseDaewonQr"), "E5 기존 QR 파서(parseDaewonQr)를 재사용한다")
const hookSrc = read("src/components/common/qr-scanner/use-qr-camera-scanner.ts")
ok(/track\.stop\(\)/.test(hookSrc) && hookSrc.includes("srcObject = null") && /return \(\) => \{[\s\S]*releaseCamera\(\)/.test(hookSrc), "E6 정리: track.stop · srcObject 해제 · 언마운트 cleanup 에서 releaseCamera")
ok(hookSrc.includes("tokenRef") && hookSrc.includes("deliveredRef") && hookSrc.includes("onScanRef.current(parsed.result)") && (hookSrc.match(/onScanRef\.current\(/g) ?? []).length === 1, "E7 중복 방지: 토큰으로 오래된 비동기 무시 · 성공 콜백은 한 곳에서 1회")
ok(hookSrc.includes("visibilitychange"), "E8 탭이 숨겨지면 카메라 종료")
ok(/setTimeout\(tick/.test(hookSrc) && !/setInterval/.test(hookSrc), "E9 디코딩 루프는 이전 해석이 끝난 뒤 다음 해석을 예약(겹침 없음, setInterval 미사용)")
const decSrc = read("src/components/common/qr-scanner/qr-decoder.ts")
ok(decSrc.includes('import("jsqr")') && !/^import .* from "jsqr"/m.test(decSrc) && decSrc.includes("BarcodeDetector") && decSrc.includes("fallback = createJsQrDecoder"), "E10 BarcodeDetector 우선 + jsQR 동적 import 폴백(실행 오류 시 영구 전환) — BarcodeDetector 단독 구조 아님")
ok(!/\b(window|document|navigator)\b/.test(read("src/components/common/qr-scanner/camera-support.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "E11 camera-support 는 import 시점에 브라우저 전역을 쓰지 않는다(SSR 안전)")
ok(!/\bwindow\b|\bdocument\b|\bnavigator\b/.test(read("src/app/label-print/scan/page.tsx")) && read("src/components/common/qr-scanner/qr-scanner-view.tsx").startsWith('"use client"') && hookSrc.startsWith('"use client"'), "E12 브라우저 전용 코드는 'use client' 컴포넌트/훅에만 있다(서버 컴포넌트 page.tsx 는 전역 미사용)")
const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
ok(Boolean(pkg.dependencies.jsqr) && !pkg.devDependencies.jsqr && !("html5-qrcode" in pkg.dependencies) && !("@zxing/browser" in pkg.dependencies), "E13 QR 인식 라이브러리는 기존 jsqr 만 사용(runtime dependency) — 신규 라이브러리 중복 설치 없음")

console.log(`\n${passed} checks passed`)
