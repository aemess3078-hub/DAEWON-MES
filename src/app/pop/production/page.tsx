export const dynamic = "force-dynamic"

import { getTodayProductionResults } from "@/lib/actions/pop.actions"
import { PopHeader } from "../components/pop-header"
import { CheckCircle2, XCircle, RefreshCw, Package } from "lucide-react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { getPopWorkerSession } from "@/lib/auth/pop-worker-session"
import { getCurrentUser } from "@/lib/auth"
import { formatQuantity } from "@/lib/utils"

export default async function ProductionResultsPage() {
  const [workerSession, results] = await Promise.all([
    getPopWorkerSession(),
    getTodayProductionResults().catch(() => [] as Awaited<ReturnType<typeof getTodayProductionResults>>),
  ])
  const currentUser = workerSession ? null : await getCurrentUser()
  const workerName = workerSession?.workerName ?? currentUser?.name ?? "작업자"

  const totalGood = results.reduce((sum, r) => sum + Number(r.goodQty), 0)
  const totalDefect = results.reduce((sum, r) => sum + Number(r.defectQty), 0)
  const totalRework = results.reduce((sum, r) => sum + Number(r.reworkQty), 0)

  return (
    <div className="flex flex-col min-h-screen">
      <PopHeader workerName={workerName} />

      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">오늘의 생산실적</h1>

        {/* 요약 카드 */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-5 border-2 border-slate-200 text-center">
            <div className="flex justify-center mb-2">
              <CheckCircle2 className="text-green-500" size={28} />
            </div>
            <div className="text-3xl font-bold text-green-600">{formatQuantity(totalGood)}</div>
            <div className="text-slate-500 mt-1 text-base">양품</div>
          </div>
          <div className="bg-white rounded-2xl p-5 border-2 border-slate-200 text-center">
            <div className="flex justify-center mb-2">
              <XCircle className="text-red-500" size={28} />
            </div>
            <div className="text-3xl font-bold text-red-600">{formatQuantity(totalDefect)}</div>
            <div className="text-slate-500 mt-1 text-base">불량</div>
          </div>
          <div className="bg-white rounded-2xl p-5 border-2 border-slate-200 text-center">
            <div className="flex justify-center mb-2">
              <RefreshCw className="text-amber-500" size={28} />
            </div>
            <div className="text-3xl font-bold text-amber-600">{formatQuantity(totalRework)}</div>
            <div className="text-slate-500 mt-1 text-base">재작업</div>
          </div>
        </div>

        {/* 실적 목록 */}
        {results.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Package className="mx-auto mb-4 text-slate-300" size={48} />
            <p className="text-xl">오늘 등록된 생산실적이 없습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {results.map((r) => {
              const op = r.workOrderOperation
              const wo = op.workOrder
              const good = Number(r.goodQty)
              const defect = Number(r.defectQty)
              const rework = Number(r.reworkQty)

              return (
                <div
                  key={r.id}
                  className="bg-white rounded-2xl p-5 border-2 border-slate-200"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-mono font-bold text-lg text-slate-800">
                        {wo.orderNo}
                      </div>
                      <div className="text-slate-600 mt-0.5">{wo.item.name}</div>
                      <div className="text-slate-400 text-sm mt-0.5">
                        {op.routingOperation?.name ?? "공정"}
                      </div>
                    </div>
                    <div className="text-sm text-slate-400">
                      {r.startedAt ? format(new Date(r.startedAt), "HH:mm", { locale: ko }) : ""}
                    </div>
                  </div>

                  <div className="flex gap-6">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-green-500" />
                      <span className="text-slate-700 font-semibold">{formatQuantity(good)}</span>
                      <span className="text-slate-400 text-sm">양품</span>
                    </div>
                    {defect > 0 && (
                      <div className="flex items-center gap-2">
                        <XCircle size={16} className="text-red-500" />
                        <span className="text-slate-700 font-semibold">{formatQuantity(defect)}</span>
                        <span className="text-slate-400 text-sm">불량</span>
                      </div>
                    )}
                    {rework > 0 && (
                      <div className="flex items-center gap-2">
                        <RefreshCw size={16} className="text-amber-500" />
                        <span className="text-slate-700 font-semibold">{formatQuantity(rework)}</span>
                        <span className="text-slate-400 text-sm">재작업</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
