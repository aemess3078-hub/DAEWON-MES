import { getCalibrationOverview } from "@/lib/actions/instrument-calibration.actions"
import { CalibrationClient } from "./calibration-client"

export const dynamic = "force-dynamic"

export default async function CalibrationPage() {
  const response = await getCalibrationOverview()

  if (!response.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">계측기 검교정관리</h1>
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-800">
          {response.error}
        </div>
      </div>
    )
  }

  return <CalibrationClient overview={response.data} />
}
