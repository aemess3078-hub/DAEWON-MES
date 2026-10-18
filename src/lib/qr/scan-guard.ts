/**
 * 스캔 중복 방어 (Phase 11 / 33절).
 *
 * 태블릿 카메라는 같은 QR 을 초당 수 회 연속 인식한다. 그리고 스캔 자체는 식별(조회)일 뿐
 * 업무 mutation 을 일으키지 않지만, 화면이 같은 LOT 를 여러 행으로 추가하거나 조회를 중복 호출하지 않도록
 * (1) 디바운스 (2) 처리 중 잠금 (3) 이미 선택된 LOT 중복 추가 방지 를 순수 함수로 제공한다.
 * 부수효과 없음(시간은 인자로 주입) — 서버/클라이언트/테스트 공용.
 */

export const DEFAULT_SCAN_DEBOUNCE_MS = 2000

export type ScanDebouncer = {
  /** 이 입력을 처리해야 하면 true. 같은 값이 window 안에 다시 들어오거나, 처리 중이면 false. */
  accept(raw: string, nowMs: number): boolean
  /** 처리 시작/종료 표시(처리 중 들어온 스캔은 모두 무시). */
  begin(): void
  end(): void
  reset(): void
  readonly busy: boolean
}

export function createScanDebouncer(windowMs: number = DEFAULT_SCAN_DEBOUNCE_MS): ScanDebouncer {
  let lastRaw: string | null = null
  let lastAt = -Infinity
  let busy = false
  return {
    accept(raw, nowMs) {
      const value = String(raw ?? "").trim()
      if (!value) return false
      if (busy) return false
      if (value === lastRaw && nowMs - lastAt < windowMs) return false
      lastRaw = value
      lastAt = nowMs
      return true
    },
    begin() {
      busy = true
    },
    end() {
      busy = false
    },
    reset() {
      lastRaw = null
      lastAt = -Infinity
      busy = false
    },
    get busy() {
      return busy
    },
  }
}

/** 이미 선택된 LOT id 집합에 대해 중복 추가를 막는다. */
export function canAddScannedLot(selectedLotIds: readonly string[], lotId: string): boolean {
  return !selectedLotIds.includes(lotId)
}
