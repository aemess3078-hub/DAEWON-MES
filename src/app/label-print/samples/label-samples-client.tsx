"use client"

import { useMemo, useState } from "react"
import { BarcodeLabel } from "@/components/common/barcode/barcode-label"
import { buildSampleLabels } from "@/lib/label/label-samples"
import { LABEL_TYPE_META, type LabelData } from "@/lib/label/label-spec"
import { LABEL_JOB_PREFIX, labelPrintUrl, saveLabelJob } from "@/lib/label/label-print-job"

/** 라벨 3종 샘플 미리보기 + 시험용 인쇄. 실제 인쇄 페이지(/label-print)를 그대로 재사용한다. */
export function LabelSamplesClient() {
  const samples = useMemo(() => buildSampleLabels(), [])
  const [message, setMessage] = useState<string | null>(null)
  const entries: Array<{ key: string; label: LabelData; note: string }> = [
    {
      key: "rawLot",
      label: samples.rawLot,
      note: "QR: DAEWON|LOT|1|<LOT 번호>. 품목코드 줄에 규격 표시. 수량·입고일 표시.",
    },
    {
      key: "wip",
      label: samples.wip,
      note: "QR: DAEWON|WIP|1|<WIP 식별값>. 수량·공정·상태는 인쇄하지 않음(MES 조회). 최초 발행 후 모든 공정에서 재사용.",
    },
    {
      key: "fgLot",
      label: samples.fgLot,
      note: "QR: DAEWON|LOT|1|<LOT 번호>(원자재와 같은 LOT QR). 수량·생산일 표시.",
    },
  ]

  function print(labels: LabelData[]) {
    setMessage(null)
    // 모바일 Chrome 팝업 차단을 피하려고 클릭 직후 동기적으로 탭을 연다.
    const win = window.open("", "_blank")
    if (!win) {
      setMessage("팝업이 차단되었습니다. 브라우저의 팝업을 허용한 뒤 다시 시도해 주세요.")
      return
    }
    let id: string | null = null
    try {
      id = saveLabelJob(window.localStorage, labels, false)
    } catch {
      id = null
    }
    if (!id) {
      win.close()
      setMessage("브라우저 저장소를 사용할 수 없어 인쇄 페이지를 열 수 없습니다.")
      return
    }
    try {
      win.location.href = labelPrintUrl(id)
    } catch {
      window.localStorage.removeItem(LABEL_JOB_PREFIX + id)
      win.close()
      setMessage("인쇄 페이지를 열지 못했습니다.")
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#f3f4f6", color: "#111827" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 8px" }}>라벨 3종 샘플 (시험용)</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 4px", color: "#374151" }}>
          Brother QL-820NWB · 용지 <b>90×29mm</b>(가로). 인쇄 설정은 용지 29×90mm 또는 사용자 정의 90×29mm, 배율 100%, 여백 없음.
          아래는 실제 크기 미리보기이며 모든 값은 TEST- 임시 값입니다(실제 LOT/WIP 아님, 출력 이력 없음).
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 16px", color: "#4b5563" }}>
          라벨이 옆으로 누워 나오면 인쇄 탭의 [용지 방향]을 바꾸세요.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          <button style={btn(true)} onClick={() => print(entries.map((e) => e.label))}>
            3종 모두 인쇄
          </button>
          {entries.map((e) => (
            <button key={e.key} style={btn(false)} onClick={() => print([e.label])}>
              {LABEL_TYPE_META[e.label.labelType!].tag}만 인쇄
            </button>
          ))}
        </div>
        {message && <p style={{ fontSize: 14, color: "#92400e", background: "#fffbeb", padding: 10, borderRadius: 6 }}>{message}</p>}

        {entries.map((e) => (
          <section key={e.key} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>{LABEL_TYPE_META[e.label.labelType!].title}</h2>
            <p style={{ fontSize: 13, color: "#4b5563", margin: "0 0 8px", lineHeight: 1.5 }}>{e.note}</p>
            <div style={{ display: "inline-block", border: "1px solid #9ca3af", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }}>
              <BarcodeLabel data={e.label} />
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function btn(primary: boolean): React.CSSProperties {
  return {
    fontSize: 15,
    fontWeight: 600,
    minHeight: 44,
    padding: "10px 16px",
    borderRadius: 8,
    border: primary ? "1px solid #1d4ed8" : "1px solid #9ca3af",
    background: primary ? "#1d4ed8" : "#fff",
    color: primary ? "#fff" : "#1f2937",
    cursor: "pointer",
  }
}
