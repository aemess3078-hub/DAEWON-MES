"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { BarcodeLabel } from "@/components/common/barcode/barcode-label"
import { LABEL_HEIGHT_MM, LABEL_WIDTH_MM, clampQrMm } from "@/lib/label/label-spec"
import { isValidLabelJobId, loadLabelJob, type LabelPrintJob } from "@/lib/label/label-print-job"

type Status = "loading" | "missing" | "ready"

const ROTATE_KEY = "daewon:label-rotate"

function readRotatePreference(urlValue: string | null): boolean {
  if (urlValue === "1") return true
  if (urlValue === "0") return false
  try {
    return window.localStorage.getItem(ROTATE_KEY) === "1"
  } catch {
    return false
  }
}

/**
 * 인쇄 CSS. 라벨 1장 = 인쇄 페이지 1개.
 *  - 기본(가로): @page 90mm × 29mm
 *  - 회전(세로): @page 29mm × 90mm 로 용지를 세로로 잡고 라벨 면을 90° 돌려 넣는다(프린터 드라이버가 29×90 세로 용지로만 인식하는 경우).
 * 이 페이지의 html/body 는 globals.css 의 overflow:hidden 을 인쇄 때 해제한다.
 */
function buildPrintCss(rotate: boolean): string {
  const pageW = rotate ? LABEL_HEIGHT_MM : LABEL_WIDTH_MM
  const pageH = rotate ? LABEL_WIDTH_MM : LABEL_HEIGHT_MM
  return `
@page { size: ${pageW}mm ${pageH}mm; margin: 0; }
.lp-root { position: fixed; inset: 0; overflow: auto; background: #e5e7eb; color: #111827; }
.lp-toolbar { position: sticky; top: 0; z-index: 5; background: #fff; border-bottom: 1px solid #d1d5db; padding: 12px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 14px; }
.lp-toolbar h1 { font-size: 18px; font-weight: 700; margin: 0; }
.lp-btn { font-size: 15px; font-weight: 600; padding: 10px 18px; border-radius: 8px; border: 1px solid #1d4ed8; background: #1d4ed8; color: #fff; cursor: pointer; min-height: 44px; }
.lp-btn[disabled] { opacity: .5; cursor: not-allowed; }
.lp-btn.secondary { background: #fff; color: #1f2937; border-color: #9ca3af; }
.lp-hint { font-size: 13px; color: #4b5563; line-height: 1.5; padding: 10px 16px; background: #fff; border-bottom: 1px solid #e5e7eb; }
.lp-warn { font-size: 14px; color: #92400e; background: #fffbeb; border-bottom: 1px solid #fcd34d; padding: 10px 16px; }
.lp-sheets { padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.lp-sheet { width: ${pageW}mm; height: ${pageH}mm; position: relative; overflow: hidden; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
${rotate ? `.lp-sheet .daewon-label-face { position: absolute; top: 0; left: ${LABEL_HEIGHT_MM}mm; transform-origin: top left; transform: rotate(90deg); }` : ""}
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; width: auto !important; height: auto !important; overflow: visible !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lp-noprint { display: none !important; }
  .lp-root { position: static !important; inset: auto !important; overflow: visible !important; background: #fff !important; }
  .lp-sheets { display: block !important; padding: 0 !important; gap: 0 !important; }
  .lp-sheet { margin: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; break-inside: avoid; }
  .lp-sheet:last-child { break-after: auto; page-break-after: auto; }
}
`
}

export function LabelPrintClient() {
  const [status, setStatus] = useState<Status>("loading")
  const [job, setJob] = useState<LabelPrintJob | null>(null)
  const [rotate, setRotate] = useState(false)
  const [qrMm, setQrMm] = useState<number | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [blockedCount, setBlockedCount] = useState(0)
  const [printed, setPrinted] = useState(false)
  const [renderFailed, setRenderFailed] = useState(false)
  const autoPrintedRef = useRef(false)
  const sheetsRef = useRef<HTMLDivElement>(null)

  // job 로드(같은 브라우저 localStorage). 서버 조회 없음.
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const id = search.get("job")
    setRotate(readRotatePreference(search.get("rot")))
    if (search.get("qr")) setQrMm(clampQrMm(search.get("qr")))
    if (!isValidLabelJobId(id)) {
      setStatus("missing")
      return
    }
    let loaded: LabelPrintJob | null = null
    try {
      loaded = loadLabelJob(window.localStorage, id)
    } catch {
      loaded = null
    }
    if (!loaded) {
      setStatus("missing")
      return
    }
    setJob(loaded)
    setStatus("ready")
    document.title = `LOT 라벨 ${loaded.labels.length}장`
  }, [])

  // QR/바코드 렌더 완료 확인 → 그 뒤에만 인쇄할 수 있다(빈 QR 인쇄 방지).
  useEffect(() => {
    if (status !== "ready" || !job) return
    let cancelled = false
    const started = Date.now()

    async function waitForRender() {
      try {
        await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready
      } catch {
        /* 폰트 API 미지원이어도 계속 */
      }
      while (!cancelled) {
        const faces = Array.from(sheetsRef.current?.querySelectorAll<HTMLElement>("[data-label-state]") ?? [])
        const pending = faces.filter((el) => el.dataset.labelState === "pending").length
        const blocked = faces.filter((el) => el.dataset.labelState === "blocked").length
        const expected = job?.labels.length ?? 0
        if (faces.length === expected && pending === 0) {
          // 레이아웃/페인트가 한 프레임 이상 지난 뒤 준비 완료로 본다.
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          if (!cancelled) {
            setBlockedCount(blocked)
            setReady(true)
          }
          return
        }
        if (Date.now() - started > 8000) {
          if (!cancelled) {
            setRenderFailed(true)
            setReady(false)
          }
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    void waitForRender()
    return () => {
      cancelled = true
    }
  }, [status, job, rotate])

  const doPrint = useCallback(() => {
    window.print()
  }, [])

  // 준비가 끝나면 한 번만 자동으로 인쇄 창을 연다. 막히면 사용자가 [인쇄] 버튼을 누른다.
  useEffect(() => {
    if (!ready || blockedCount > 0 || autoPrintedRef.current) return
    autoPrintedRef.current = true
    const timer = setTimeout(doPrint, 250)
    return () => clearTimeout(timer)
  }, [ready, blockedCount, doPrint])

  useEffect(() => {
    const onAfterPrint = () => setPrinted(true)
    window.addEventListener("afterprint", onAfterPrint)
    return () => window.removeEventListener("afterprint", onAfterPrint)
  }, [])

  function toggleRotate(next: boolean) {
    setRotate(next)
    try {
      window.localStorage.setItem(ROTATE_KEY, next ? "1" : "0")
    } catch {
      /* 저장 실패해도 현재 화면에는 적용 */
    }
  }

  if (status === "loading") {
    return <div style={{ padding: 24, fontSize: 15 }}>라벨을 준비하는 중입니다…</div>
  }

  if (status === "missing" || !job) {
    return (
      <div className="lp-root" style={{ position: "fixed", inset: 0, padding: 24, background: "#fff", fontSize: 15, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>인쇄할 라벨 정보를 찾을 수 없습니다</h1>
        <p style={{ margin: 0 }}>
          유효 시간(30분)이 지났거나 다른 브라우저에서 열린 주소입니다. MES 화면으로 돌아가 [인쇄] 버튼을 다시 눌러 주세요.
        </p>
        <button className="lp-btn secondary" style={{ marginTop: 16 }} onClick={() => window.close()}>
          닫기
        </button>
      </div>
    )
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: buildPrintCss(rotate) }} />
      <div className="lp-root">
        <div className="lp-toolbar lp-noprint">
          <h1>라벨 인쇄 · {job.labels.length}장</h1>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            용지 방향
            <select
              value={rotate ? "rot" : "land"}
              onChange={(e) => toggleRotate(e.target.value === "rot")}
              style={{ fontSize: 14, padding: "8px 10px", minHeight: 40, border: "1px solid #9ca3af", borderRadius: 6 }}
            >
              <option value="land">가로 90×29mm (기본)</option>
              <option value="rot">세로 29×90mm (라벨 회전)</option>
            </select>
          </label>
          <button className="lp-btn" onClick={doPrint} disabled={!ready || blockedCount > 0}>
            {ready ? "인쇄" : "준비 중…"}
          </button>
          <button className="lp-btn secondary" onClick={() => window.close()}>
            닫기
          </button>
        </div>
        {blockedCount > 0 && (
          <div className="lp-warn lp-noprint">
            출력할 수 없는 라벨이 {blockedCount}장 있습니다(LOT 번호 없음 등). MES 화면에서 입고 완료 후 다시 출력해 주세요.
          </div>
        )}
        {renderFailed && (
          <div className="lp-warn lp-noprint">
            QR 을 그리지 못해 인쇄를 막았습니다(빈 QR 출력 방지). 페이지를 새로고침하거나 MES 화면에서 다시 출력해 주세요.
          </div>
        )}
        {!ready && blockedCount === 0 && !renderFailed && (
          <div className="lp-hint lp-noprint">QR 이미지를 준비하는 중입니다. 준비가 끝나면 인쇄 버튼이 활성화됩니다.</div>
        )}
        <div className="lp-hint lp-noprint">
          {printed ? "인쇄 요청이 전달되었습니다. 라벨이 나오지 않으면 아래 설정을 확인해 주세요. " : ""}
          프린터 설정: 용지 크기 <b>29×90mm(또는 사용자 정의 90×29mm)</b> · 배율 <b>100% / 실제 크기</b> · 여백 <b>없음</b> · 머리글/바닥글 끄기.
          라벨이 옆으로 누워 나오면 위 [용지 방향]을 바꿔 보세요.
          {job.reprint ? " (재출력 라벨 — LOT 번호와 QR 은 최초 출력과 동일합니다)" : ""}
        </div>

        <div className="lp-sheets" ref={sheetsRef}>
          {job.labels.map((label, i) => (
            <div className="lp-sheet" key={i}>
              <BarcodeLabel data={label} reprint={job.reprint} qrMm={qrMm} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
