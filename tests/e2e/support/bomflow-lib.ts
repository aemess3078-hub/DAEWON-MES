/**
 * BOM·라우팅·검사표준·통합 흐름 테스트 공용 지원 코드 (로컬 테스트 DB 전용 — 스펙 시작 시 assertSafeE2eEnvironment 가 가드).
 *  - 시드 데이터(test-results/e2e/bomflow-data.json) 로드
 *  - DB 검증용 Prisma 클라이언트(읽기 위주; 테스트가 UI 로 만든 행의 정리는 seed-bomflow.ts REMOVE=1)
 *  - 테스트 단위별 생성 식별자 기록(test-results/e2e/bomflow-detail.jsonl)
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { expect, type Page } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import { dialog } from "../tc-helpers"

const ROOT = process.cwd()
export const DATA_FILE = path.resolve(ROOT, "test-results/e2e/bomflow-data.json")
export const DETAIL_FILE = path.resolve(ROOT, "test-results/e2e/bomflow-detail.jsonl")

export type Ref = { id: string; code: string; name: string }
export type BomFlowData = {
  tenantId: string
  prefix: string
  site: Ref
  categories: { fg: Ref; rm: Ref }
  group: Ref
  items: { fg1: Ref; fg2: Ref; rm1: Ref; rm2: Ref }
  workCenters: { wc1: Ref; wc2: Ref }
  equipments: { eq1: Ref; eq2: Ref }
}

export function loadData(): BomFlowData {
  if (!fs.existsSync(DATA_FILE)) throw new Error(`시드 데이터가 없습니다: ${DATA_FILE} (tests/e2e/support/seed-bomflow.ts 먼저 실행)`)
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
}

export const db = new PrismaClient()

/**
 * 시드 1회당 고유 접미사(대문자 5자). Playwright 는 실패한 테스트 뒤에 워커를 새로 띄워 모듈을 다시 읽으므로
 * Date.now() 를 쓰면 같은 파일 안에서도 값이 바뀐다 → 시드 JSON 의 createdAt 으로 고정한다.
 */
export const uniq = (() => {
  try {
    const t = Date.parse(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")).createdAt)
    return t.toString(36).toUpperCase().slice(-5)
  } catch { return Date.now().toString(36).toUpperCase().slice(-5) }
})()

/** 단위별 식별자·관찰값 기록(보고서의 '생성 데이터' 근거) */
export function record(unit: string, tcId: string | null, info: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(DETAIL_FILE), { recursive: true })
  fs.appendFileSync(DETAIL_FILE, JSON.stringify({ at: new Date().toISOString(), unit, tcId, ...info }) + "\n", "utf8")
}

export const submitBtn = (page: Page) => dialog(page).getByRole("button", { name: /^(등록|저장)$/ })

export async function settle(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
}

export async function openCreate(page: Page, re: RegExp) {
  await page.getByRole("button", { name: re }).first().click()
  await expect(dialog(page)).toBeVisible()
}

/** Radix Select: 라벨이 붙은 트리거를 열고 옵션 선택 */
export async function pickLabeled(page: Page, label: string | RegExp, option: string | RegExp) {
  await dialog(page).getByLabel(label).first().click()
  await page.getByRole("option", { name: option }).first().click()
}

/** Radix Select: 아직 값이 없는(placeholder 표시 중인) 트리거 중 첫 번째를 열고 옵션 선택 */
export async function pickByPlaceholder(page: Page, placeholder: string | RegExp, option: string | RegExp) {
  await dialog(page).locator('button[role="combobox"]').filter({ hasText: placeholder }).first().click()
  await page.getByRole("option", { name: option }).first().click()
}

export async function searchBox(page: Page, text: string) {
  const box = page.getByPlaceholder(/검색/).first()
  await expect(box).toBeVisible({ timeout: 20_000 })
  await box.fill(text)
}

/** 화면에 보이는 검증/오류 안내 문구(폼 메시지·토스트·인라인) 수집 */
export async function visibleMessages(page: Page): Promise<string[]> {
  const loc = page.locator('[role="dialog"] .text-destructive, [role="dialog"] [role="alert"], [data-sonner-toast], [role="status"], p.text-destructive, [id$="-form-item-message"]')
  return (await loc.allInnerTexts()).map((s) => s.trim()).filter(Boolean)
}

export function dec(v: unknown): number {
  return Number(v as { toString(): string })
}
