import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const quality = readFileSync(resolve("src/lib/actions/quality.actions.ts"), "utf8")
const staged = readFileSync(resolve("src/lib/actions/inspection-stages.actions.ts"), "utf8")
const helper = readFileSync(resolve("src/lib/actions/quality-inspection-integrity.helpers.ts"), "utf8")
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8")

assert.match(quality, /validateInspectionMutationContext\(prisma, tenantId, data\)/)
assert.match(staged, /validateInspectionMutationContext\(prisma, tenantId/)
assert.match(helper, /operation\.workOrder\.itemId !== spec\.itemId/)
assert.match(helper, /tenantUsers: \{ some: \{ tenantId, isActive: true \} \}/)
assert.match(helper, /defectCode\.count/)
assert.match(quality, /assertInspectionHistoryMutable\(tx, id, tenantId\)/)
assert.match(quality, /assertInspectionHistoryMutable\(prisma, id, tenantId\)/)
assert.match(staged, /assertInspectionHistoryMutable\(prisma, inspectionId, tenantId\)/)
assert.doesNotMatch(quality, /defectCauseAnalysis\.deleteMany/)
assert.doesNotMatch(quality, /defectCorrectiveAction\.deleteMany/)
assert.doesNotMatch(quality, /defectRecurrencePrevention\.deleteMany/)
assert.match(schema, /defectRecord DefectRecord @relation\(fields: \[defectRecordId\], references: \[id\]\)/)

console.log("quality history integrity: PASS")
