export const dynamic = "force-dynamic"

import { getTodayWorkOrders } from "@/lib/actions/pop.actions"
import { WorkSelectClient } from "./work-select-client"
import { PopHeader } from "../components/pop-header"
import { getPopWorkerSession } from "@/lib/auth/pop-worker-session"
import { getCurrentUser } from "@/lib/auth"

export default async function WorkSelectPage() {
  const [workerSession, workOrders] = await Promise.all([
    getPopWorkerSession(),
    getTodayWorkOrders().catch(() => [] as Awaited<ReturnType<typeof getTodayWorkOrders>>),
  ])
  const currentUser = workerSession ? null : await getCurrentUser()
  const workerName = workerSession?.workerName ?? currentUser?.name ?? "작업자"

  return (
    <div className="flex flex-col min-h-screen">
      <PopHeader workerName={workerName} />
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">작업지시</h1>
        <WorkSelectClient workOrders={workOrders} />
      </main>
    </div>
  )
}
