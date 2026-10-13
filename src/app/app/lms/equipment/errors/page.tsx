import {
  getEquipmentOptions,
  getEquipmentErrorEvents,
} from "@/lib/actions/equipment-statistics.actions"
import { ErrorsClient } from "./errors-client"

export const dynamic = "force-dynamic"

interface Props {
  searchParams?: {
    from?: string
    to?: string
    equipmentId?: string
  }
}

export default async function ErrorsPage({ searchParams }: Props) {
  const [equipmentOptions, { events, summary, appliedFilter }] =
    await Promise.all([
      getEquipmentOptions(),
      getEquipmentErrorEvents(
        searchParams?.from,
        searchParams?.to,
        searchParams?.equipmentId
      ),
    ])

  return (
    <ErrorsClient
      equipments={equipmentOptions}
      initialEvents={events}
      summary={summary}
      appliedFilter={appliedFilter}
    />
  )
}
