"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import JsBarcode from "jsbarcode"
import {
  LABEL_TYPE_META,
  TEST_LABEL_MARK,
  LABEL_GAP_MM,
  LABEL_HEIGHT_MM,
  LABEL_PADDING_MM,
  LABEL_QR_MM_DEFAULT,
  LABEL_WIDTH_MM,
  computeLabelLayout,
  getLabelBlock,
  labelContentHeightMm,
  type LabelData,
} from "@/lib/label/label-spec"
import { buildLotQrSvgData, buildWipQrSvgData } from "@/lib/qr/qr-svg"

interface BarcodeLabelProps {
  data: LabelData
  /** 재출력 라벨 표시(LOT 번호/QR 은 최초 출력과 동일하다). */
  reprint?: boolean
  /** QR 한 변(mm, quiet zone 포함). 기본 19mm. */
  qrMm?: number
  companyName?: string
}

const FONT_SANS = '"Malgun Gothic","Noto Sans KR","Noto Sans CJK KR","Apple SD Gothic Neo","Nanum Gothic",sans-serif'
const FONT_MONO = 'ui-monospace,"Consolas","Courier New","Noto Sans Mono",monospace'

/**
 * 29×90mm 라벨 1장 (가로 90mm × 세로 29mm).
 * 모든 치수는 mm/pt 인라인 스타일로 고정한다 — Tailwind/화면 CSS 에 영향받지 않고 미리보기와 인쇄가 같은 모양이 된다.
 *  - 라벨 3종(labelType): RAW_LOT 원자재 / WIP 공정·재공 통합 / FG_LOT 완제품. 헤더에 유형 칩을 표시한다.
 *  - LOT_QR: 왼쪽 LOT QR, 오른쪽 대원정밀·품목명·품목코드(+규격)·LOT·수량·일자
 *  - WIP_QR: 왼쪽 WIP QR, 오른쪽 대원정밀·품목명·품목코드+WO·WIP 식별값·제조번호·발행일 (수량/공정/상태는 인쇄하지 않음 — MES 조회)
 *  - ITEM_BARCODE: LOT 이 없는 품목 라벨(출하/출고 등 호출자가 명시적으로 허용한 화면). 상단 텍스트 + 하단 CODE128.
 * LOT 번호가 없는 LOT_QR 라벨은 QR 을 만들지 않고 출력 불가 사유를 보여 준다(임의 식별자/CODE128 대체 금지).
 *
 * data-label-state: "ready"(QR/바코드 렌더 완료) | "pending" | "blocked"(출력 불가) — 인쇄 페이지가 이 값을 보고 인쇄 시점을 정한다.
 */
export function BarcodeLabel({ data, reprint = false, qrMm = LABEL_QR_MM_DEFAULT, companyName = "대원정밀" }: BarcodeLabelProps) {
  const block = getLabelBlock(data)
  const layout = useMemo(() => computeLabelLayout(data, qrMm), [data, qrMm])
  const qr = useMemo(() => {
    if (!block.printable) return null
    try {
      if (data.kind === "LOT_QR" && data.lotNo) return buildLotQrSvgData(data.lotNo)
      if (data.kind === "WIP_QR" && data.wipId) return buildWipQrSvgData(data.wipId)
    } catch {
      return null
    }
    return null
  }, [data.kind, data.lotNo, data.wipId, block.printable])

  const svgRef = useRef<SVGSVGElement>(null)
  const [barcodeReady, setBarcodeReady] = useState(false)
  const barcodeValue = data.lotId ? `${data.itemCode}|${data.lotId}` : data.itemCode

  useEffect(() => {
    if (data.kind !== "ITEM_BARCODE") return
    const svg = svgRef.current
    if (!svg) return
    try {
      JsBarcode(svg, barcodeValue, { format: "CODE128", width: 2, height: 50, displayValue: false, margin: 0 })
      const w = svg.getAttribute("width")
      const h = svg.getAttribute("height")
      if (w && h) svg.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`)
      svg.removeAttribute("width")
      svg.removeAttribute("height")
      svg.setAttribute("preserveAspectRatio", "none")
      setBarcodeReady(true)
    } catch (e) {
      console.error("바코드 생성 오류:", e)
      setBarcodeReady(false)
    }
  }, [data.kind, barcodeValue])

  const isQrKind = data.kind !== "ITEM_BARCODE"
  const ready = isQrKind ? qr !== null : barcodeReady
  const state = !block.printable ? "blocked" : ready ? "ready" : "pending"

  const row: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", lineHeight: 1.15 }

  return (
    <div
      className="daewon-label-face"
      data-label-state={state}
      data-label-kind={data.kind}
      data-label-test={data.test ? "true" : undefined}
      style={{
        width: `${LABEL_WIDTH_MM}mm`,
        height: `${LABEL_HEIGHT_MM}mm`,
        boxSizing: "border-box",
        padding: `${LABEL_PADDING_MM}mm`,
        display: "flex",
        flexDirection: isQrKind ? "row" : "column",
        alignItems: isQrKind ? "center" : "stretch",
        gap: `${LABEL_GAP_MM}mm`,
        background: "#fff",
        color: "#000",
        overflow: "hidden",
        fontFamily: FONT_SANS,
      }}
    >
      {!block.printable ? (
        <div style={{ fontSize: "9pt", lineHeight: 1.3, fontWeight: 700, width: "100%" }} data-label-blocked>
          출력 불가
          <div style={{ fontWeight: 400, fontSize: "8pt", marginTop: "1mm" }}>{block.reason}</div>
        </div>
      ) : (
        <>
          {isQrKind && (
            <div style={{ width: `${layout.qrMm}mm`, height: `${layout.qrMm}mm`, flex: "none", background: "#fff" }} data-label-qr>
              {qr && (
                <svg
                  viewBox={`0 0 ${qr.viewBoxSize} ${qr.viewBoxSize}`}
                  width="100%"
                  height="100%"
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label={`${data.kind === "WIP_QR" ? "WIP" : "LOT"} QR ${data.kind === "WIP_QR" ? data.wipId : data.lotNo}`}
                  data-qr-payload={qr.payload}
                >
                  <rect width={qr.viewBoxSize} height={qr.viewBoxSize} fill="#fff" />
                  <path d={qr.pathD} fill="#000" />
                </svg>
              )}
            </div>
          )}

          <div
            style={{
              width: `${layout.textWidthMm}mm`,
              height: isQrKind ? `${labelContentHeightMm()}mm` : undefined,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "0.2mm",
              overflow: "hidden",
              flex: "none",
            }}
            data-label-text
          >
            <div style={{ ...row, display: "flex", justifyContent: "space-between", fontSize: `${layout.companyPt}pt`, fontWeight: 700 }}>
              <span>
                {companyName}
                {data.labelType && (
                  <span
                    style={{ marginLeft: "1.5mm", border: "0.25mm solid #000", padding: "0 1mm", fontSize: "7.5pt" }}
                    data-label-type={data.labelType}
                  >
                    {LABEL_TYPE_META[data.labelType].tag}
                  </span>
                )}
                {data.test && (
                  <span style={{ marginLeft: "1.5mm", background: "#000", color: "#fff", padding: "0 1mm", fontSize: "7.5pt" }} data-label-test>
                    {TEST_LABEL_MARK}
                  </span>
                )}
                {reprint && (
                  <span style={{ marginLeft: "1.5mm", border: "0.2mm solid #000", padding: "0 0.8mm", fontSize: "7pt" }}>재출력</span>
                )}
              </span>
              <span style={{ fontWeight: 400 }}>
                {data.date ? `${data.dateLabel} ${data.date}` : ""}
              </span>
            </div>

            <div style={{ fontWeight: 700, fontSize: `${layout.name.fontPt}pt` }} data-label-name>
              {layout.name.lines.map((line, i) => (
                <div key={i} style={row}>
                  {line}
                </div>
              ))}
            </div>

            <div style={{ ...row, fontSize: `${layout.codePt}pt`, fontFamily: FONT_MONO }}>{layout.codeText}</div>

            {layout.lot && (
              <div style={{ fontWeight: 700, fontSize: `${layout.lot.fontPt}pt`, fontFamily: FONT_MONO }} data-label-lot>
                {layout.lot.lines.map((line, i) => (
                  <div key={i} style={row}>
                    {line}
                  </div>
                ))}
              </div>
            )}

            {layout.last && <div style={{ ...row, fontWeight: 700, fontSize: `${layout.last.fontPt}pt` }}>{layout.last.text}</div>}
          </div>

          {data.kind === "ITEM_BARCODE" && (
            <svg ref={svgRef} style={{ width: "100%", height: "6mm", flex: "none" }} data-label-barcode />
          )}
        </>
      )}
    </div>
  )
}
