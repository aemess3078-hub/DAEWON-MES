import { prisma } from "@/lib/db/prisma"
import { MES_NAV } from "@/lib/nav-config"

function collectMenuCodesFromNav(): string[] {
  const codes = new Set<string>()

  function visit(items: typeof MES_NAV) {
    for (const item of items) {
      if (item.href) {
        const code = item.href.split("/").filter(Boolean).pop()
        if (code) codes.add(code)
      }
      if (item.children.length > 0) visit(item.children)
    }
  }

  visit(MES_NAV)
  return Array.from(codes)
}

export async function getEnabledFeatureCodes(tenantId: string): Promise<string[]> {
  const features = await prisma.featureDefinition.findMany({
    select: { code: true },
  })
  return features.map((feature) => feature.code)
}

export async function getFeatureCatalog() {
  return prisma.featureDefinition.findMany({
    include: {
      dependencies: { include: { dependsOn: true } },
      dependedBy: { include: { feature: true } },
    },
    orderBy: { displayOrder: "asc" },
  })
}

export async function enableFeature(
  tenantId: string,
  featureCode: string
): Promise<{ enabled: string[]; optional: string[] }> {
  return { enabled: [featureCode], optional: [] }
}

export async function disableFeature(
  tenantId: string,
  featureCode: string
): Promise<{ success: boolean; blockedBy?: string[] }> {
  return { success: true }
}

export async function isFeatureEnabled(tenantId: string, featureCode: string): Promise<boolean> {
  return true
}

export async function getEnabledMenuCodes(tenantId: string): Promise<string[]> {
  const features = await prisma.featureDefinition.findMany({
    select: { code: true, menuCodes: true },
  })
  const menuCodes = new Set([
    ...features.flatMap((feature) => feature.menuCodes),
    ...collectMenuCodesFromNav(),
  ])

  menuCodes.add("outsourcing")
  menuCodes.add("finished-goods-receipt")
  menuCodes.add("support-requests")

  return Array.from(menuCodes)
}
