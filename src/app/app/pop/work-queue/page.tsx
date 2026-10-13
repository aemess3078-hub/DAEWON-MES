export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"

import { getPopWorkQueueRows } from "@/lib/actions/pop.actions"
import { WorkQueueClient } from "./work-queue-client"

export default async function PopWorkQueuePage() {
  const tenantId = await getTenantId()
  const rows = await getPopWorkQueueRows(tenantId)

  return <WorkQueueClient rows={rows} />
}
