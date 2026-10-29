/**
 * 라벨 3종 인쇄 미리보기 검증 (실제 Chrome 인쇄 엔진으로 PDF 생성 — 프린터 출력 없음, DB·로그인 불필요).
 *
 * 사전 조건: 개발 서버 실행  /  Chrome 설치
 *   LABEL_TEST_URL=http://localhost:3115 npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true}' --project tsconfig.json scripts/test-label-types-browser.ts
 *
 * 확인 항목: 용지 90×29mm(가로) / 회전 29×90mm, 라벨당 1페이지(빈 페이지 없음), 인쇄 매체에서 UI 제거,
 * 텍스트·QR 가 라벨 안쪽(잘림 없음), 브라우저가 그린 QR 디코딩(LOT/WIP 구분), 샘플 페이지 동작.
 * 한계: 데스크톱 Chrome 인쇄 엔진 기준. Android Chrome + Brother Print Service Plugin 의 용지 처리는 현장 확인 대상.
 */
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, devices, type Page } from "playwright-core"
import jsQR from "jsqr"
// pngjs 는 qrcode 의 의존 패키지다(타입 선언 없음).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PNG } = require("pngjs") as { PNG: { sync: { read(buffer: Buffer): { data: Buffer; width: number; height: number } } } }

const BASE = process.env.LABEL_TEST_URL ?? "http://localhost:3115"
const PX_PER_MM = 96 / 25.4
const OUT = join(process.cwd(), "docs", "qr-label-samples", "types")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

const longName = "초고강도 알루미늄 합금 6061-T6 정밀가공 브라켓 어셈블리 (좌측 하단 보강형) 대형 특수 규격품 최종 검사 완료"
const ymd = "20261027"
const date = "2026-10-27"
const labels = [
  { kind: "LOT_QR", labelType: "RAW_LOT", test: true, itemCode: "RM-STS304-0012", itemName: "스테인리스 봉재 STS304 Φ12", spec: "Φ12×3000", lotNo: `TEST-${ymd}-001`, quantity: 120, uom: "KG", date, dateLabel: "입고일" },
  { kind: "WIP_QR", labelType: "WIP", test: true, itemCode: "FG-BRK-0001", itemName: "브라켓 어셈블리 (좌측 보강형)", wipId: `TEST-WIP-${ymd}-001`, manufacturingNo: `TEST-${ymd}-A01`, workOrderNo: "WO-TEST-0001", date, dateLabel: "발행일" },
  { kind: "LOT_QR", labelType: "FG_LOT", test: true, itemCode: "FG-BRK-0001", itemName: "브라켓 어셈블리 (좌측 보강형)", lotNo: `TEST-${ymd}-002`, quantity: 500, uom: "EA", date, dateLabel: "생산일" },
  // 긴 입력(잘림 확인)
  { kind: "LOT_QR", labelType: "RAW_LOT", test: true, itemCode: "RM-LONG-0001", itemName: longName, spec: "긴 규격 문자열 Φ12×3000 열처리 SUS304 규격 아주 긴 규격 문자열", lotNo: "TEST-20261027-001-REWORK-LINE02-SHIFT-A-BATCH-000123-EXTRA", quantity: 1234567.123456, uom: "KG", date, dateLabel: "입고일" },
  { kind: "WIP_QR", labelType: "WIP", test: true, itemCode: "FG-LONG-0001", itemName: longName, wipId: "TEST-WIP-20261027-REWORK-LINE02-SHIFT-A-BATCH-000123-EXTRA-LONG-IDENTIFIER", manufacturingNo: "TEST-26A01-000123-REWORK-SHIFT-A", workOrderNo: "WO-2026-000123", date, dateLabel: "발행일" },
  { kind: "LOT_QR", labelType: "FG_LOT", test: true, itemCode: "FG-LONG-0002", itemName: longName, lotNo: "TEST-FG-20261027-0007-LONG-LOT-NUMBER-SAMPLE", quantity: 99999999, uom: "EA", date, dateLabel: "생산일" },
]
const expectedPayload = labels.map((l) => (l.kind === "WIP_QR" ? `DAEWON|WIP|1|${encodeURIComponent(l.wipId!)}` : `DAEWON|LOT|1|${encodeURIComponent(l.lotNo!)}`))
const JOB = "0a1b2c3d4e5f60718293a4b5"

async function waitReady(page: Page) {
  await page.waitForFunction(
    () => {
      const faces = Array.from(document.querySelectorAll<HTMLElement>("[data-label-state]"))
      const button = document.querySelector<HTMLButtonElement>("button.lp-btn")
      return faces.length > 0 && faces.every((f) => f.dataset.labelState === "ready") && !!button && !button.disabled
    },
    undefined,
    { timeout: 20000 },
  )
}
function pdfInfo(buffer: Buffer) {
  const text = buffer.toString("latin1")
  return {
    pages: (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length,
    boxes: Array.from(text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)).map((m) => [Number(m[1]), Number(m[2])] as [number, number]),
  }
}
const ptToMm = (pt: number) => (pt * 25.4) / 72

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 4 })
    await context.addInitScript(() => {
      window.print = () => {}
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))

    await page.goto(`${BASE}/label-print?job=missing`)
    await page.evaluate(({ id, labels }) => window.localStorage.setItem("daewon:label-job:" + id, JSON.stringify({ v: 1, createdAt: Date.now(), reprint: false, labels })), { id: JOB, labels })

    // ── 가로 90×29mm (기본) ─────────────────────────────────────────────
    await page.goto(`${BASE}/label-print?job=${JOB}`)
    await waitReady(page)
    ok((await page.$$("[data-label-state=ready]")).length === labels.length, `1 라벨 ${labels.length}장 렌더 완료(QR 포함)`)

    // 화면(미리보기) 매체: 라벨별 크기/넘침/잘림
    const measure = async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".daewon-label-face")).map((face) => {
          const f = face.getBoundingClientRect()
          const text = face.querySelector<HTMLElement>("[data-label-text]")!
          const t = text.getBoundingClientRect()
          const q = face.querySelector<HTMLElement>("[data-label-qr]")!.getBoundingClientRect()
          const rows = Array.from(text.children) as HTMLElement[]
          const top = Math.min(...rows.map((r) => r.getBoundingClientRect().top))
          const bottom = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom))
          const overflowX = Array.from(text.querySelectorAll<HTMLElement>("div, span")).filter((e) => e.scrollWidth > e.clientWidth + 1).length
          return {
            w: f.width,
            h: f.height,
            contentTop: top - f.top,
            contentBottom: f.bottom - bottom,
            textRight: f.right - t.right,
            qrInside: q.top >= f.top && q.bottom <= f.bottom && q.left >= f.left && q.right <= t.left,
            overflowX,
            type: face.querySelector<HTMLElement>("[data-label-type]")?.dataset.labelType ?? null,
          }
        }),
      )
    await page.emulateMedia({ media: "print" })
    const m = await measure()
    m.forEach((l, i) => {
      ok(Math.abs(l.w - 90 * PX_PER_MM) < 1 && Math.abs(l.h - 29 * PX_PER_MM) < 1, `2-${i + 1} 라벨 면 90×29mm`)
      ok(l.contentTop >= 1.5 * PX_PER_MM - 1 && l.contentBottom >= 1.5 * PX_PER_MM - 1, `3-${i + 1} 위·아래 여백 ≥ 1.5mm(잘림 없음) 위 ${(l.contentTop / PX_PER_MM).toFixed(1)}mm 아래 ${(l.contentBottom / PX_PER_MM).toFixed(1)}mm`)
      ok(l.overflowX === 0 && l.qrInside && l.textRight >= 1.5 * PX_PER_MM - 1, `4-${i + 1} 가로 넘침 없음 · QR/텍스트가 라벨 안쪽(오른쪽 여백 ${(l.textRight / PX_PER_MM).toFixed(1)}mm)`)
    })
    ok(m.map((l) => l.type).join() === "RAW_LOT,WIP,FG_LOT,RAW_LOT,WIP,FG_LOT", "5 유형 칩: 원자재 / WIP / 완제품")
    const ui = await page.evaluate(() => ({
      toolbar: Array.from(document.querySelectorAll(".lp-noprint")).some((e) => getComputedStyle(e).display !== "none"),
      text: document.body.innerText,
    }))
    ok(!ui.toolbar && !/라벨 인쇄|프린터 설정|용지 방향|닫기/.test(ui.text), "6 인쇄 매체: 툴바·안내 UI 제거(라벨만)")
    const pdf = pdfInfo(await page.pdf({ preferCSSPageSize: true, printBackground: true }))
    ok(pdf.pages === labels.length, `7 라벨 ${labels.length}장 → PDF ${pdf.pages}페이지(1장=1페이지, 빈 페이지 없음)`)
    ok(pdf.boxes.every(([w, h]) => Math.abs(ptToMm(w) - 90) < 0.3 && Math.abs(ptToMm(h) - 29) < 0.3), `8 인쇄 용지 90×29mm 가로 (${pdf.boxes.map(([w, h]) => `${ptToMm(w).toFixed(1)}×${ptToMm(h).toFixed(1)}`)[0]})`)

    // 브라우저가 그린 QR 디코딩
    await page.emulateMedia({ media: "screen" })
    for (let i = 0; i < labels.length; i++) {
      const png = PNG.sync.read(await page.locator("[data-label-qr]").nth(i).screenshot())
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
      ok(decoded?.data === expectedPayload[i], `9-${i + 1} QR 디코딩 → ${decoded?.data?.slice(0, 44)}`)
    }
    const names = ["raw-lot", "wip", "fg-lot", "raw-lot-long", "wip-long", "fg-lot-long"]
    for (let i = 0; i < labels.length; i++) await page.locator(".daewon-label-face").nth(i).screenshot({ path: join(OUT, `label-${names[i]}.png`) })

    // ── 회전(29×90mm 용지) ──────────────────────────────────────────────
    await page.emulateMedia({ media: "print" })
    await page.goto(`${BASE}/label-print?job=${JOB}&rot=1`)
    await waitReady(page)
    const rot = pdfInfo(await page.pdf({ preferCSSPageSize: true, printBackground: true }))
    ok(rot.pages === labels.length && rot.boxes.every(([w, h]) => Math.abs(ptToMm(w) - 29) < 0.3 && Math.abs(ptToMm(h) - 90) < 0.3), `10 회전 모드: 29×90mm 용지 · ${rot.pages}페이지`)
    const rotInside = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".lp-sheet")).every((sheet) => {
        const s = sheet.getBoundingClientRect()
        const f = sheet.querySelector<HTMLElement>(".daewon-label-face")!.getBoundingClientRect()
        return f.left >= s.left - 1 && f.right <= s.right + 1 && f.top >= s.top - 1 && f.bottom <= s.bottom + 1
      }),
    )
    ok(rotInside, "11 회전 모드: 라벨 면이 29×90mm 용지 안쪽(잘림 없음)")
    await page.emulateMedia({ media: "screen" })
    await page.locator(".lp-sheet").nth(1).screenshot({ path: join(OUT, "wip-rotated-29x90.png") })

    // ── 샘플 페이지(3종) ────────────────────────────────────────────────
    await page.goto(`${BASE}/label-print/samples`)
    await page.waitForSelector("[data-label-state=ready]", { timeout: 20000 })
    const sample = await page.evaluate(() => ({
      faces: Array.from(document.querySelectorAll<HTMLElement>("[data-label-type]")).map((e) => e.dataset.labelType),
      ready: Array.from(document.querySelectorAll<HTMLElement>("[data-label-state]")).every((e) => e.dataset.labelState === "ready"),
      text: document.body.innerText,
    }))
    ok(sample.faces.join() === "RAW_LOT,WIP,FG_LOT" && sample.ready, "12 샘플 페이지: 3종 미리보기 렌더")
    ok(sample.text.includes("시험용") && /3종 모두 인쇄/.test(sample.text), "13 샘플 페이지: 시험용 표시 · 인쇄 버튼")
    await page.screenshot({ path: join(OUT, "samples-page.png"), fullPage: false })
    // [3종 모두 인쇄] → 새 탭이 /label-print?job=… 로 열리고 3장이 준비된다
    const [popup] = await Promise.all([context.waitForEvent("page"), page.getByText("3종 모두 인쇄").click()])
    await popup.waitForURL(/\/label-print\?job=/, { timeout: 20000 })
    await popup.waitForFunction(() => document.querySelectorAll("[data-label-state=ready]").length === 3, undefined, { timeout: 20000 })
    ok(true, "14 샘플 [3종 모두 인쇄] → 인쇄 페이지가 열리고 3장 준비 완료")
    ok(errors.length === 0, `15 페이지 오류 없음 ${errors.join(" | ")}`)
    await context.close()

    // ── 모바일 폭 ──────────────────────────────────────────────────────
    const mobile = await browser.newContext({ ...devices["Pixel 5"] })
    await mobile.addInitScript(() => {
      window.print = () => {}
    })
    const mp = await mobile.newPage()
    await mp.goto(`${BASE}/label-print/samples`)
    await mp.waitForSelector("[data-label-state=ready]", { timeout: 20000 })
    const mo = await mp.evaluate(() => {
      const root = document.querySelector<HTMLElement>("div[style*='fixed']")!
      return { sw: root.scrollWidth, cw: root.clientWidth }
    })
    ok(mo.sw <= mo.cw + 1, `16 모바일(393px) 샘플 페이지 가로 넘침 없음 (${mo.sw}/${mo.cw})`)
    await mobile.close()
  } finally {
    await browser.close()
  }
  console.log(`\n${passed} browser checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
