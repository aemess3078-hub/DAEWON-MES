/**
 * 라벨 전용 인쇄 페이지(/label-print)를 실제 Chrome 에서 검증한다 (DB·로그인·프린터 불필요).
 *
 * 사전 조건: 개발 서버 실행 (npm run dev -- -p 3111)  /  Chrome 설치
 *   LABEL_TEST_URL=http://localhost:3111 npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-qr-label-browser.ts
 *
 * 검증
 *  1. 인쇄 매체에서 라벨만 남는다(툴바·안내·MES UI 없음)
 *  2. PDF 용지 크기 = 90×29mm, 라벨 N장 → N페이지(마지막 빈 페이지 없음)
 *  3. 회전 모드 = 29×90mm
 *  4. 긴 품목명/긴 LOT 가 라벨 영역 안에 있다(넘침 없음)
 *  5. 브라우저가 실제로 그린 QR 을 래스터로 캡처해 디코딩 → LOT 식별
 *  6. 만료/없는 job 안내, 자동 인쇄 1회 호출, 모바일 폭 가로 스크롤 없음
 *
 * 한계: 헤드리스 PDF 는 Chrome 데스크톱 인쇄 엔진 기준이다. Android Chrome → Brother Print Service Plugin 의
 * 사용자 정의 용지 처리와 실제 용지 출력은 현장에서 확인한다.
 */
import assert from "node:assert/strict"
import { join } from "node:path"
import { chromium, devices, type Page } from "playwright-core"
// pngjs 는 qrcode 의 의존 패키지다(타입 선언 없음).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PNG } = require("pngjs") as { PNG: { sync: { read(buffer: Buffer): { data: Buffer; width: number; height: number } } } }
import jsQR from "jsqr"

const BASE = process.env.LABEL_TEST_URL ?? "http://localhost:3111"
const PX_PER_MM = 96 / 25.4

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

const longName = "초고강도 알루미늄 합금 6061-T6 정밀가공 브라켓 어셈블리 (좌측 하단 보강형) 대형 특수 규격품 최종 검사 완료"
const labels = [
  { kind: "LOT_QR", itemCode: "CNS-0001", itemName: "브라켓", lotNo: "CNS-RM-20261026-001", quantity: 1000, uom: "EA", date: "2026-10-26", dateLabel: "입고일" },
  { kind: "LOT_QR", itemCode: "CNS-0002", itemName: longName, lotNo: "CNS-RM-20261026-001-REWORK-LINE02-SHIFT-A-BATCH-000123-EXTRA", quantity: 1234567.123456, uom: "KG", date: "2026-10-26", dateLabel: "생산일" },
  { kind: "LOT_QR", itemCode: "CNS-0003", itemName: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", lotNo: "대원-FG-20261026-0007", quantity: 5, uom: "EA", date: "2026-10-26", dateLabel: "생산일" },
]
const JOB_ID = "0123456789abcdef01234567"

async function seed(page: Page, id = JOB_ID, createdAt = Date.now(), reprint = false) {
  await page.goto(`${BASE}/label-print?job=missing`)
  await page.evaluate(
    ({ id, createdAt, labels, reprint }) => {
      window.localStorage.setItem("daewon:label-job:" + id, JSON.stringify({ v: 1, createdAt, reprint, labels }))
    },
    { id, createdAt, labels, reprint },
  )
}

async function waitReady(page: Page) {
  // 인쇄 매체에서는 버튼이 숨겨지므로 라벨 렌더 상태 + 활성화된 인쇄 버튼(DOM 속성)으로 확인한다.
  await page.waitForFunction(() => {
    const faces = Array.from(document.querySelectorAll<HTMLElement>("[data-label-state]"))
    const button = document.querySelector<HTMLButtonElement>("button.lp-btn")
    return faces.length > 0 && faces.every((f) => f.dataset.labelState === "ready") && !!button && !button.disabled
  }, undefined, { timeout: 20000 })
}

function pdfInfo(buffer: Buffer): { pages: number; boxes: Array<[number, number]> } {
  const text = buffer.toString("latin1")
  const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
  const boxes = Array.from(text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)).map((m) => [Number(m[1]), Number(m[2])] as [number, number])
  return { pages, boxes }
}
const ptToMm = (pt: number) => (pt * 25.4) / 72

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  try {
    // ─── 데스크톱 Chrome ───────────────────────────────────────────────
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 4 })
    await context.addInitScript(() => {
      ;(window as unknown as { __printCalls: number }).__printCalls = 0
      window.print = () => {
        ;(window as unknown as { __printCalls: number }).__printCalls += 1
      }
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))

    await seed(page)
    await page.goto(`${BASE}/label-print?job=${JOB_ID}`)
    await waitReady(page)
    const states = await page.$$eval("[data-label-state]", (els) => els.map((e) => (e as HTMLElement).dataset.labelState))
    ok(states.length === 3 && states.every((s) => s === "ready"), "1 라벨 3장 모두 렌더 완료(ready) 후 인쇄 버튼 활성화")
    await page.waitForTimeout(600)
    const autoCalls = await page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls)
    ok(autoCalls === 1, `2 준비 완료 후 인쇄가 정확히 1회 자동 호출됨 (호출 ${autoCalls}회)`)

    // 라벨 외 화면 요소 확인(화면 매체): 툴바는 있지만 인쇄 매체에서는 사라진다
    ok((await page.locator(".lp-toolbar").count()) === 1, "3 화면에는 툴바가 있다")
    await page.emulateMedia({ media: "print" })
    const printed = await page.evaluate(() => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        return getComputedStyle(el).display !== "none" && r.width > 0 && r.height > 0
      }
      return {
        toolbarVisible: Array.from(document.querySelectorAll(".lp-noprint")).some(visible),
        bodyText: document.body.innerText,
        sheets: document.querySelectorAll(".lp-sheet").length,
        bodyOverflow: getComputedStyle(document.body).overflow,
        rootPosition: getComputedStyle(document.querySelector(".lp-root")!).position,
      }
    })
    ok(!printed.toolbarVisible, "4 인쇄 매체: 툴바·안내문이 보이지 않는다")
    ok(!/라벨 인쇄|프린터 설정|용지 방향|닫기|발주|대원정밀 MES/.test(printed.bodyText), "5 인쇄 매체: UI 문구(제목/버튼/설명) 없음 — 라벨 텍스트만 남음")
    ok(printed.bodyOverflow === "visible" && printed.rootPosition === "static", "6 인쇄 매체: 스크롤 영역 해제(잘림 방지)")

    // PDF
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    const info = pdfInfo(pdf)
    ok(info.pages === 3, `7 라벨 3장 → PDF 3페이지 (실제 ${info.pages}페이지, 빈 페이지 없음)`)
    ok(
      info.boxes.length > 0 && info.boxes.every(([w, h]) => Math.abs(ptToMm(w) - 90) < 0.3 && Math.abs(ptToMm(h) - 29) < 0.3),
      `8 PDF 용지 크기 90×29mm (${info.boxes.map(([w, h]) => `${ptToMm(w).toFixed(1)}×${ptToMm(h).toFixed(1)}`).join(", ")})`,
    )

    // 레이아웃 넘침 검사(인쇄 매체 기준)
    const layout = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>(".daewon-label-face")).map((face) => {
        const r = face.getBoundingClientRect()
        const text = face.querySelector<HTMLElement>("[data-label-text]")!
        const rows = Array.from(text.querySelectorAll<HTMLElement>("div, span")).filter((e) => e.children.length === 0 || e.tagName === "DIV")
        const overflowRows = rows.filter((e) => e.scrollWidth > e.clientWidth + 1).length
        const t = text.getBoundingClientRect()
        const qr = face.querySelector<HTMLElement>("[data-label-qr]")!.getBoundingClientRect()
        return {
          w: r.width,
          h: r.height,
          textScrollH: Math.round(Math.max(...Array.from(text.children).map((c) => (c as HTMLElement).getBoundingClientRect().bottom)) - Math.min(...Array.from(text.children).map((c) => (c as HTMLElement).getBoundingClientRect().top))),
          textClientH: text.clientHeight,
          overflowRows,
          textInside: t.top >= r.top - 0.5 && t.bottom <= r.bottom + 0.5 && t.right <= r.right + 0.5,
          qrInside: qr.top >= r.top && qr.bottom <= r.bottom && qr.left >= r.left,
          qrMm: qr.width / (96 / 25.4),
          qrTextGap: t.left - qr.right,
        }
      })
    })
    layout.forEach((l, i) => {
      ok(Math.abs(l.w - 90 * PX_PER_MM) < 1 && Math.abs(l.h - 29 * PX_PER_MM) < 1, `9-${i + 1} 라벨 면 90×29mm (${(l.w / PX_PER_MM).toFixed(1)}×${(l.h / PX_PER_MM).toFixed(1)})`)
      ok(l.textScrollH <= l.textClientH + 1, `10-${i + 1} 텍스트 세로 넘침 없음 (${l.textScrollH}/${l.textClientH}px)`)
      ok(l.overflowRows === 0, `11-${i + 1} 텍스트 가로 넘침 없음`)
      ok(l.textInside && l.qrInside, `12-${i + 1} 텍스트·QR 이 라벨 면 안쪽`)
      ok(Math.abs(l.qrMm - 19) < 0.2 && l.qrTextGap >= 0, `13-${i + 1} QR ${l.qrMm.toFixed(1)}mm · QR/텍스트 겹침 없음`)
    })

    // 브라우저가 실제로 그린 QR → 디코딩
    await page.emulateMedia({ media: "screen" })
    for (let i = 0; i < labels.length; i++) {
      const buf = await page.locator("[data-label-qr]").nth(i).screenshot()
      const png = PNG.sync.read(buf)
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
      const expected = `DAEWON|LOT|1|${encodeURIComponent(labels[i].lotNo)}`
      ok(decoded?.data === expected, `14-${i + 1} 실제 렌더된 QR 디코딩 → ${decoded?.data?.slice(0, 40)}`)
    }
    await page.locator(".daewon-label-face").first().screenshot({ path: join(process.cwd(), "docs", "qr-label-samples", "label-sample-1.png") })
    await page.locator(".daewon-label-face").nth(1).screenshot({ path: join(process.cwd(), "docs", "qr-label-samples", "label-sample-2.png") })
    await page.locator(".daewon-label-face").nth(2).screenshot({ path: join(process.cwd(), "docs", "qr-label-samples", "label-sample-3.png") })

    // 회전 모드
    await page.emulateMedia({ media: "print" })
    await page.goto(`${BASE}/label-print?job=${JOB_ID}&rot=1`)
    await waitReady(page)
    const pdfRot = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    const rotInfo = pdfInfo(pdfRot)
    ok(rotInfo.pages === 3, `15 회전 모드도 3페이지 (${rotInfo.pages})`)
    ok(rotInfo.boxes.every(([w, h]) => Math.abs(ptToMm(w) - 29) < 0.3 && Math.abs(ptToMm(h) - 90) < 0.3), `16 회전 모드 PDF 용지 29×90mm`)
    const rotInside = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".lp-sheet")).every((sheet) => {
        const s = sheet.getBoundingClientRect()
        const f = sheet.querySelector<HTMLElement>(".daewon-label-face")!.getBoundingClientRect()
        return f.left >= s.left - 1 && f.right <= s.right + 1 && f.top >= s.top - 1 && f.bottom <= s.bottom + 1
      }),
    )
    ok(rotInside, "17 회전 모드: 라벨 면이 29×90mm 용지 안쪽")

    // 단일 라벨 → 1페이지(빈 페이지 없음)
    await page.emulateMedia({ media: "screen" })
    const singleId = "fedcba9876543210fedcba98"
    await page.goto(`${BASE}/label-print?job=missing`)
    await page.evaluate(
      ({ id, label }) => window.localStorage.setItem("daewon:label-job:" + id, JSON.stringify({ v: 1, createdAt: Date.now(), reprint: true, labels: [label] })),
      { id: singleId, label: labels[0] },
    )
    await page.goto(`${BASE}/label-print?job=${singleId}`)
    await waitReady(page)
    await page.emulateMedia({ media: "print" })
    const single = pdfInfo(await page.pdf({ preferCSSPageSize: true, printBackground: true }))
    ok(single.pages === 1, `18 라벨 1장 → PDF 1페이지 (${single.pages})`)
    ok((await page.evaluate(() => document.body.innerText)).includes("재출력"), "19 재출력 job 은 라벨에 '재출력' 표시")

    // 시험용 라벨(임시 LOT 번호 + '시험용' 표시) — 재출력 표시와 함께 있어도 헤더가 넘치지 않는다
    await page.emulateMedia({ media: "screen" })
    const testId = "1111222233334444aaaabbbb"
    const testLabels = [
      { kind: "LOT_QR", test: true, itemCode: "CNS-0001", itemName: longName, lotNo: "TEST-20261026-001", quantity: 1234567.5, uom: "KG", date: "2026-10-26", dateLabel: "입고일" },
      { kind: "LOT_QR", test: true, itemCode: "CNS-0002", itemName: "브라켓", lotNo: "TEST-20261026-002", quantity: 5, uom: "EA", date: "2026-10-26", dateLabel: "출고일" },
    ]
    await page.goto(`${BASE}/label-print?job=missing`)
    await page.evaluate(
      ({ id, labels }) => window.localStorage.setItem("daewon:label-job:" + id, JSON.stringify({ v: 1, createdAt: Date.now(), reprint: true, labels })),
      { id: testId, labels: testLabels },
    )
    await page.goto(`${BASE}/label-print?job=${testId}`)
    await waitReady(page)
    const testState = await page.evaluate(() => {
      const faces = Array.from(document.querySelectorAll<HTMLElement>(".daewon-label-face"))
      return faces.map((face) => {
        const header = face.querySelector<HTMLElement>("[data-label-text] > div")!
        const mark = face.querySelector<HTMLElement>("[data-label-test]")
        return { testMark: mark?.textContent ?? null, headerOverflow: header.scrollWidth > header.clientWidth + 1, text: face.innerText }
      })
    })
    ok(testState.every((t) => t.testMark === "시험용" && !t.headerOverflow), "19b 시험용 라벨 2장: '시험용' 표시 · 재출력 표시와 함께여도 헤더 넘침 없음")
    for (let i = 0; i < testLabels.length; i++) {
      const png = PNG.sync.read(await page.locator("[data-label-qr]").nth(i).screenshot())
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
      ok(decoded?.data === `DAEWON|LOT|1|${testLabels[i].lotNo}`, `19c-${i + 1} 시험용 QR 디코딩 → ${decoded?.data}`)
    }
    await page.locator(".daewon-label-face").first().screenshot({ path: join(process.cwd(), "docs", "qr-label-samples", "label-sample-test.png") })
    // LOT 번호가 실제 번호인데 시험용 표시가 붙은 job 은 거부된다
    await page.evaluate(() =>
      window.localStorage.setItem(
        "daewon:label-job:cccccccccccccccccccccccc",
        JSON.stringify({ v: 1, createdAt: Date.now(), reprint: false, labels: [{ kind: "LOT_QR", test: true, itemCode: "A", itemName: "B", lotNo: "CNS-RM-1", date: "x", dateLabel: "y" }] }),
      ),
    )
    await page.goto(`${BASE}/label-print?job=cccccccccccccccccccccccc`)
    await page.waitForSelector("text=인쇄할 라벨 정보를 찾을 수 없습니다", { timeout: 10000 })
    ok(true, "19d 실제 LOT 번호에 시험용 표시를 단 job 은 거부")

    // 만료/없는 job
    await page.emulateMedia({ media: "screen" })
    await seed(page, "aaaaaaaaaaaaaaaaaaaaaaaa", Date.now() - 31 * 60 * 1000)
    await page.goto(`${BASE}/label-print?job=aaaaaaaaaaaaaaaaaaaaaaaa`)
    await page.waitForSelector("text=인쇄할 라벨 정보를 찾을 수 없습니다", { timeout: 10000 })
    ok(true, "20 만료된 job 은 안내 문구를 보여 준다(라벨 미출력)")
    await page.goto(`${BASE}/label-print`)
    await page.waitForSelector("text=인쇄할 라벨 정보를 찾을 수 없습니다", { timeout: 10000 })
    ok(true, "21 job 파라미터가 없으면 안내 문구")

    // LOT 번호 없는 job 은 저장 자체가 거부(sanitize)
    await page.evaluate(() =>
      window.localStorage.setItem(
        "daewon:label-job:bbbbbbbbbbbbbbbbbbbbbbbb",
        JSON.stringify({ v: 1, createdAt: Date.now(), reprint: false, labels: [{ kind: "LOT_QR", itemCode: "A", itemName: "B", date: "x", dateLabel: "y" }] }),
      ),
    )
    await page.goto(`${BASE}/label-print?job=bbbbbbbbbbbbbbbbbbbbbbbb`)
    await page.waitForSelector("text=인쇄할 라벨 정보를 찾을 수 없습니다", { timeout: 10000 })
    ok(true, "22 LOT 번호 없는 LOT_QR job 은 거부(임의 QR 생성 없음)")
    ok(errors.length === 0, `23 페이지 오류 없음 ${errors.join(" | ")}`)
    await context.close()

    // ─── 모바일(Android Chrome 에뮬레이션) ──────────────────────────────
    const mobile = await browser.newContext({ ...devices["Pixel 5"] })
    await mobile.addInitScript(() => {
      window.print = () => {}
    })
    const mp = await mobile.newPage()
    await seed(mp)
    await mp.goto(`${BASE}/label-print?job=${JOB_ID}`)
    await waitReady(mp)
    const overflow = await mp.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".lp-root")!
      const toolbar = document.querySelector<HTMLElement>(".lp-toolbar")!
      return { rootScrollW: root.scrollWidth, rootClientW: root.clientWidth, toolbarScrollW: toolbar.scrollWidth, toolbarClientW: toolbar.clientWidth }
    })
    ok(overflow.toolbarScrollW <= overflow.toolbarClientW + 1, `24 모바일 폭: 툴바 가로 넘침 없음 (${overflow.toolbarScrollW}/${overflow.toolbarClientW})`)
    ok(overflow.rootScrollW <= overflow.rootClientW + 1, `25 모바일 폭(393px): 라벨 90mm 가 화면에 들어간다 (${overflow.rootScrollW}/${overflow.rootClientW})`)
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
