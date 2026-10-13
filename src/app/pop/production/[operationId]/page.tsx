export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { getOperationDetail } from "@/lib/actions/pop.actions"
import { ProductionClient } from "./production-client"
import { PopHeader } from "../../components/pop-header"
import { getPopWorkerSession } from "@/lib/auth/pop-worker-session"
import { getCurrentUser } from "@/lib/auth"

type Props = {
  params: Promise<{ operationId: string }>
  searchParams?: Promise<{ assignmentId?: string | string[] }>
}

export default async function ProductionPage({ params, searchParams }: Props) {
  const { operationId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const rawAssignmentId = resolvedSearchParams.assignmentId
  const assignmentId = Array.isArray(rawAssignmentId) ? rawAssignmentId[0] : rawAssignmentId
  const [workerSession, op] = await Promise.all([
    getPopWorkerSession(),
    getOperationDetail(operationId, assignmentId),
  ])
  if (!op) notFound()
  const currentUser = workerSession ? null : await getCurrentUser()
  const workerName = workerSession?.workerName ?? currentUser?.name ?? "작업자"

  return (
    <div className="flex flex-col min-h-screen">
      <PopHeader workerName={workerName} />
      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <ProductionClient operation={op} />
      </main>
    </div>
  )
}
