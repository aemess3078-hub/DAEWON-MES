import { defineConfig } from "@playwright/test"

/**
 * 전체 메뉴 E2E 설정 — 로컬 테스트 DB 에 연결된 로컬 앱 서버 전용.
 * 실행 전 tests/e2e/guard.ts 가 (UI_BASE 가 로컬, DAEWON_TEST_DB_CONFIRM, DATABASE_URL 이 127.0.0.1 의 *_test) 를 확인한다.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e/results.json" }]],
  outputDir: "test-results/e2e/artifacts",
  use: {
    baseURL: process.env.UI_BASE ?? "http://127.0.0.1:3130",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "off",
  },
})
