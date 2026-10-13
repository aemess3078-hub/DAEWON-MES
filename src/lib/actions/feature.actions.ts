"use server"

import { enableFeature, disableFeature, getFeatureCatalog } from "@/lib/services/feature.service"
import { revalidatePath } from "next/cache"
import { assertDeveloperOnly } from "@/lib/auth/daewon-scope.server"

export async function getCatalogWithStatus(tenantId: string) {
  await assertDeveloperOnly()
  const catalog = await getFeatureCatalog()

  return catalog.map((feature) => ({
    ...feature,
    isEnabled: true,
  }))
}

export async function enableFeatureAction(tenantId: string, featureCode: string) {
  await assertDeveloperOnly()
  const result = await enableFeature(tenantId, featureCode)
  revalidatePath("/app/mes/features")
  revalidatePath("/app/mes")
  return result
}

export async function disableFeatureAction(tenantId: string, featureCode: string) {
  await assertDeveloperOnly()
  const result = await disableFeature(tenantId, featureCode)
  revalidatePath("/app/mes/features")
  revalidatePath("/app/mes")
  return result
}
