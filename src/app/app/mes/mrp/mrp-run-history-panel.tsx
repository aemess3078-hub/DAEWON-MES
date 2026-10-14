"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { getOrderMrpRun, listOrderMrpRuns } from "@/lib/actions/mrp-run.actions"
import type { MrpRunDetail, MrpRunListResult } from "@/lib/services/mrp-run.service"
import { MrpRunDetailView, MrpRunListTable } from "./mrp-run-views"

const PAGE_SIZE = 20

/**
 * MRP 실행이력 탭(Phase 6).
 *  - 목록은 요약 컬럼만 페이지 단위로 조회한다(Snapshot JSON 미조회).
 *  - 상세는 저장된 Snapshot 값을 그대로 보여 준다(재계산 없음). 수정/삭제 기능은 없다.
 */
export function MrpRunHistoryPanel() {
  const [list, setList] = useState<MrpRunListResult | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<MrpRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await listOrderMrpRuns({ page: p, pageSize: PAGE_SIZE })
      setList(res)
      setPage(res.page)
    } catch (e) {
      setError(e instanceof Error ? e.message : "실행이력을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(1)
  }, [load])

  async function open(id: string) {
    setDetailLoading(true)
    setError(null)
    try {
      const res = await getOrderMrpRun(id)
      if (!res.success) {
        setError(res.error)
        return
      }
      setDetail(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "실행이력을 불러오지 못했습니다.")
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold">MRP 실행이력</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">
          저장한 MRP 결과와 그 결과로 생성한 DRAFT 구매발주를 확인합니다. 저장된 값은 수정·삭제할 수 없고 다시 계산하지 않습니다.
        </p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">{error}</div>}
      {detailLoading && (
        <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          실행 결과를 불러오는 중...
        </div>
      )}
      {detail ? (
        <MrpRunDetailView detail={detail} onBack={() => setDetail(null)} />
      ) : (
        <MrpRunListTable
          items={list?.items ?? []}
          page={list?.page ?? page}
          totalPages={list?.totalPages ?? 1}
          total={list?.total ?? 0}
          loading={loading}
          onOpen={open}
          onPage={(p) => void load(p)}
        />
      )}
    </div>
  )
}
