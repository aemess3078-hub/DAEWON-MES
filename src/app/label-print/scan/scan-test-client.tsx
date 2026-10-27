"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Camera, Eraser, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BarcodeLabel } from "@/components/common/barcode/barcode-label"
import { QrScannerDialog } from "@/components/common/qr-scanner/qr-scanner-dialog"
import { QrScannerView } from "@/components/common/qr-scanner/qr-scanner-view"
import type { QrDecoderMode } from "@/components/common/qr-scanner/qr-decoder"
import { buildSampleLabels } from "@/lib/label/label-samples"
import { buildQrSvgData } from "@/lib/qr/qr-svg"
import type { QrScanResult } from "@/lib/qr/qr-scan-result"

type Env = { secure: boolean; mediaDevices: boolean; barcodeDetector: boolean }

const INVALID_SAMPLES = [
  { key: "batch", title: "정의되지 않은 종류(BATCH)", payload: "DAEWON|BATCH|1|TEST-BATCH-001", note: "거부되어야 함" },
  { key: "version", title: "지원하지 않는 버전", payload: "DAEWON|LOT|9|TEST-20261027-001", note: "거부되어야 함" },
  { key: "text", title: "일반 텍스트", payload: "HELLO WORLD", note: "거부되어야 함" },
]

function SampleQr({ payload, size = 150 }: { payload: string; size?: number }) {
  const qr = useMemo(() => buildQrSvgData(payload), [payload])
  return (
    <svg viewBox={`0 0 ${qr.viewBoxSize} ${qr.viewBoxSize}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={payload}>
      <rect width={qr.viewBoxSize} height={qr.viewBoxSize} fill="#fff" />
      <path d={qr.pathD} fill="#000" />
    </svg>
  )
}

/** 공통 카메라 QR 스캐너 점검 화면. 인식 결과를 표시만 하며 서버/DB/업무 API 를 호출하지 않는다. */
export function QrScanTestClient() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [inlineOpen, setInlineOpen] = useState(false)
  const [result, setResult] = useState<QrScanResult | null>(null)
  const [count, setCount] = useState(0)
  const [env, setEnv] = useState<Env | null>(null)
  const [decoderMode, setDecoderMode] = useState<QrDecoderMode>("auto")
  const samples = useMemo(() => buildSampleLabels(), [])

  useEffect(() => {
    setEnv({
      secure: window.isSecureContext,
      mediaDevices: !!navigator.mediaDevices?.getUserMedia,
      barcodeDetector: typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === "function",
    })
    const mode = new URLSearchParams(window.location.search).get("decoder")
    if (mode === "jsqr" || mode === "native") setDecoderMode(mode)
  }, [])

  function handleScan(next: QrScanResult) {
    setResult(next)
    setCount((c) => c + 1)
  }

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto" }} className="bg-gray-100 text-gray-900">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4">
        <header>
          <h1 className="text-[26px] font-bold">QR 스캐너 테스트</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-gray-700">
            공통 카메라 QR 스캐너 점검 화면입니다. 인식한 QR 의 <b>종류·버전·식별값·원본</b>만 표시하며, 서버·DB·업무 처리는 호출하지 않습니다.
          </p>
          <p className="mt-1 text-[13px] text-gray-600">
            라벨 인쇄 샘플은 <Link href="/label-print/samples" className="text-blue-700 underline">/label-print/samples</Link> 에서 확인할 수 있습니다.
          </p>
        </header>

        <section className="rounded-lg border bg-white p-4" data-testid="env-panel">
          <h2 className="text-[18px] font-semibold">실행 환경</h2>
          {env ? (
            <ul className="mt-2 space-y-1 text-[14px]">
              <li>보안 연결(HTTPS/localhost): <b data-testid="env-secure">{env.secure ? "예" : "아니오 — 카메라 사용 불가"}</b></li>
              <li>카메라 API: <b data-testid="env-media">{env.mediaDevices ? "지원" : "미지원"}</b></li>
              <li>BarcodeDetector(내장 QR 인식): <b data-testid="env-detector">{env.barcodeDetector ? "있음" : "없음 → jsQR 로 인식"}</b></li>
              <li>디코더 선택: <b data-testid="env-decoder-mode">{decoderMode}</b> <span className="text-gray-500">(주소에 ?decoder=jsqr 로 강제 가능)</span></li>
            </ul>
          ) : (
            <p className="mt-2 text-[14px] text-gray-500">확인 중…</p>
          )}
        </section>

        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-[18px] font-semibold">스캐너 실행</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="lg" className="h-12 gap-2 text-[15px]" onClick={() => setDialogOpen(true)} data-testid="open-scanner">
              <Camera className="h-4 w-4" />
              QR 스캔 시작
            </Button>
            <Button size="lg" variant="outline" className="h-12 gap-2 text-[15px]" onClick={() => setInlineOpen((v) => !v)} data-testid="toggle-inline">
              <ScanLine className="h-4 w-4" />
              {inlineOpen ? "인라인 스캐너 숨기기" : "인라인 스캐너 보기"}
            </Button>
          </div>
          {inlineOpen && (
            <div className="mt-4" data-testid="inline-scanner">
              <QrScannerView decoderMode={decoderMode} onScan={handleScan} onClose={() => setInlineOpen(false)} />
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-white p-4" data-testid="result-panel">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[18px] font-semibold">스캔 결과</h2>
            <Button variant="outline" size="sm" className="h-9 gap-1 text-[14px]" onClick={() => { setResult(null); setCount(0) }} data-testid="clear-result">
              <Eraser className="h-4 w-4" />
              지우기
            </Button>
          </div>
          <p className="mt-1 text-[13px] text-gray-600">
            콜백 호출 횟수: <b data-testid="scan-count">{count}</b>
          </p>
          {result ? (
            <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[15px]">
              <dt className="text-gray-600">QR 종류</dt>
              <dd className="font-semibold" data-testid="result-kind">{result.kind}</dd>
              <dt className="text-gray-600">버전</dt>
              <dd data-testid="result-version">{result.version}</dd>
              <dt className="text-gray-600">식별값</dt>
              <dd className="break-all font-mono" data-testid="result-id">{result.id}</dd>
              <dt className="text-gray-600">원본 QR</dt>
              <dd className="break-all font-mono text-[14px]" data-testid="result-raw">{result.raw}</dd>
            </dl>
          ) : (
            <p className="mt-3 text-[14px] text-gray-500" data-testid="result-empty">아직 인식한 QR 이 없습니다.</p>
          )}
          {result?.kind === "LOT" && (
            <p className="mt-3 rounded-md bg-gray-50 p-3 text-[13px] text-gray-700">
              LOT QR 은 원자재와 완제품의 형식이 같아 QR 문자열만으로 구분하지 않습니다. 실제 구분은 업무 화면이 서버 데이터를 조회해 판단합니다.
            </p>
          )}
        </section>

        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-[18px] font-semibold">테스트용 QR 샘플</h2>
          <p className="mt-1 text-[13px] text-gray-600">다른 화면(PC 모니터 등)에 띄운 샘플을 카메라로 비춰 보세요. 모두 시험용 값입니다.</p>
          <div className="mt-3 flex flex-col gap-4">
            {([["원자재 LOT 샘플", samples.rawLot], ["WIP 샘플", samples.wip], ["완제품 LOT 샘플", samples.fgLot]] as const).map(([title, label]) => (
              <div key={title}>
                <p className="mb-1 text-[14px] font-medium">{title}</p>
                <div className="inline-block max-w-full overflow-x-auto border border-gray-300 bg-white">
                  <BarcodeLabel data={label} />
                </div>
              </div>
            ))}
          </div>
          <h3 className="mt-5 text-[15px] font-semibold">거부되어야 하는 QR (스캔해도 결과로 전달되지 않음)</h3>
          <div className="mt-2 flex flex-wrap gap-4">
            {INVALID_SAMPLES.map((sample) => (
              <div key={sample.key} className="w-[160px] text-[13px]" data-testid={`invalid-sample-${sample.key}`}>
                <SampleQr payload={sample.payload} />
                <p className="font-medium">{sample.title}</p>
                <p className="break-all font-mono text-gray-500">{sample.payload}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <QrScannerDialog open={dialogOpen} onOpenChange={setDialogOpen} onScan={handleScan} decoderMode={decoderMode} />
    </div>
  )
}
