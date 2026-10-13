"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { X } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatQuantity } from "@/lib/utils"
import {
  getToolDetail,
  updateTool,
  deleteTool,
  createToolUsageHistory,
  type ToolDetail,
  type ToolFilterOptions,
} from "@/lib/actions/tool.actions"
import { createRepairRequest, createDailyCheck } from "@/lib/actions/equipment-management.actions"
import { TYPE_LABEL, STATUS_CONFIG } from "./columns"

const NONE_VALUE = "__NONE__"

const REPAIR_PRIORITY_LABEL: Record<string, string> = {
  LOW: "낮음",
  MEDIUM: "보통",
  HIGH: "높음",
  CRITICAL: "긴급",
}

const REPAIR_STATUS_LABEL: Record<string, string> = {
  OPEN: "접수",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

const CHECK_RESULT_LABEL: Record<string, string> = {
  PASS: "합격",
  FAIL: "불합격",
  NA: "해당없음",
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function todayDateKey(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface ToolDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  toolId: string | null
  filterOptions: ToolFilterOptions
  onChanged: () => void
}

export function ToolDetailSheet({ open, onOpenChange, toolId, filterOptions, onChanged }: ToolDetailSheetProps) {
  const [detail, setDetail] = useState<ToolDetail | null>(null)
  const [loading, setLoading] = useState(false)

  // 기본정보 수정
  const [name, setName] = useState("")
  const [workCenterId, setWorkCenterId] = useState("")
  const [lifeLimit, setLifeLimit] = useState("")
  const [itemIds, setItemIds] = useState<string[]>([])
  const [addItemValue, setAddItemValue] = useState("")
  const [isSavingInfo, setIsSavingInfo] = useState(false)

  // 사용이력 등록
  const [usedAt, setUsedAt] = useState(todayDateKey())
  const [usageCount, setUsageCount] = useState("")
  const [usageItemId, setUsageItemId] = useState("")
  const [usageOperatorId, setUsageOperatorId] = useState("")
  const [usageNote, setUsageNote] = useState("")
  const [isSavingUsage, setIsSavingUsage] = useState(false)

  // 점검이력 등록
  const [checkDate, setCheckDate] = useState(todayDateKey())
  const [checkResult, setCheckResult] = useState<"PASS" | "FAIL" | "NA">("PASS")
  const [checkNote, setCheckNote] = useState("")
  const [isSavingCheck, setIsSavingCheck] = useState(false)

  // 수리이력 등록
  const [repairTitle, setRepairTitle] = useState("")
  const [repairDescription, setRepairDescription] = useState("")
  const [repairPriority, setRepairPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM")
  const [isSavingRepair, setIsSavingRepair] = useState(false)

  useEffect(() => {
    if (!open || !toolId) return
    setLoading(true)
    getToolDetail(toolId)
      .then((d) => {
        setDetail(d)
        if (d) {
          setName(d.tool.name)
          setWorkCenterId(d.tool.workCenterId)
          setLifeLimit(d.tool.lifeLimit?.toString() ?? "")
          setItemIds(d.tool.appliedItems.map((i) => i.id))
        }
      })
      .finally(() => setLoading(false))
  }, [open, toolId])

  const selectedItems = useMemo(
    () => itemIds.map((id) => filterOptions.items.find((i) => i.id === id)).filter((i): i is { id: string; code: string; name: string } => Boolean(i)),
    [itemIds, filterOptions.items]
  )

  async function refresh() {
    if (!toolId) return
    const d = await getToolDetail(toolId)
    setDetail(d)
    onChanged()
  }

  if (!open || !toolId) return null

  function handleAddItem(value: string) {
    if (value && !itemIds.includes(value)) setItemIds([...itemIds, value])
    setAddItemValue("")
  }
  function handleRemoveItem(id: string) {
    setItemIds(itemIds.filter((i) => i !== id))
  }

  async function handleSaveInfo() {
    if (!name.trim()) {
      alert("공구명을 입력해 주세요.")
      return
    }
    setIsSavingInfo(true)
    try {
      await updateTool(toolId!, { name, workCenterId, lifeLimit: lifeLimit || null, itemIds })
      await refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsSavingInfo(false)
    }
  }

  async function handleChangeStatus(status: "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "DISCARDED") {
    if (status === "DISCARDED" && !confirm("폐기 처리하면 다시 되돌릴 수 없습니다. 계속하시겠습니까?")) return
    try {
      await updateTool(toolId!, { status })
      await refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "처리 중 오류가 발생했습니다.")
    }
  }

  async function handleDelete() {
    if (!confirm("이 공구를 삭제하시겠습니까? 되돌릴 수 없습니다.")) return
    try {
      await deleteTool(toolId!)
      onChanged()
      onOpenChange(false)
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  async function handleRegisterUsage() {
    if (!usageCount || Number(usageCount) <= 0) {
      alert("사용량을 입력해 주세요.")
      return
    }
    setIsSavingUsage(true)
    try {
      await createToolUsageHistory({
        equipmentId: toolId!,
        usedAt,
        usageCount,
        itemId: usageItemId || null,
        operatorId: usageOperatorId || null,
        note: usageNote || null,
      })
      setUsageCount("")
      setUsageNote("")
      await refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsSavingUsage(false)
    }
  }

  async function handleRegisterCheck() {
    setIsSavingCheck(true)
    try {
      await createDailyCheck({
        equipmentId: toolId!,
        checkDate: new Date(checkDate),
        result: checkResult,
        note: checkNote || undefined,
      })
      setCheckNote("")
      await refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsSavingCheck(false)
    }
  }

  async function handleRegisterRepair() {
    if (!repairTitle.trim()) {
      alert("수리내용(제목)을 입력해 주세요.")
      return
    }
    setIsSavingRepair(true)
    try {
      await createRepairRequest({
        equipmentId: toolId!,
        title: repairTitle,
        description: repairDescription || undefined,
        priority: repairPriority,
      })
      setRepairTitle("")
      setRepairDescription("")
      await refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsSavingRepair(false)
    }
  }

  const tool = detail?.tool
  const workCentersForSite = filterOptions.workCenters.filter((wc) => !tool || wc.siteId === tool.siteId)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            공구 상세
            {tool && <Badge className={`${STATUS_CONFIG[tool.status].className} border-0 text-[12px] font-medium`}>{STATUS_CONFIG[tool.status].label}</Badge>}
          </SheetTitle>
          <SheetDescription>기본정보부터 수명·사용·점검·수리 이력까지 한 화면에서 확인합니다.</SheetDescription>
        </SheetHeader>

        {loading && <p className="text-[14px] text-muted-foreground pt-4">불러오는 중...</p>}

        {!loading && tool && (
          <div className="space-y-6 pt-4">
            {/* 기본정보 */}
            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">기본정보</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[14px]">
                <div><span className="text-muted-foreground">공구번호</span> <span className="font-mono">{tool.code}</span></div>
                <div><span className="text-muted-foreground">유형</span> {TYPE_LABEL[tool.equipmentType]}</div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">공구명</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">보관위치(작업장)</Label>
                <Select value={workCenterId} onValueChange={setWorkCenterId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {workCentersForSite.map((wc) => (
                      <SelectItem key={wc.id} value={wc.id}>{wc.code} / {wc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">수명기준 (선택)</Label>
                <Input type="number" min={1} value={lifeLimit} onChange={(e) => setLifeLimit(e.target.value)} placeholder="비워두면 수명 관리 안 함" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">적용품목</Label>
                <Select value={addItemValue} onValueChange={handleAddItem}>
                  <SelectTrigger><SelectValue placeholder="품목을 선택하면 추가됩니다" /></SelectTrigger>
                  <SelectContent>
                    {filterOptions.items.filter((it) => !itemIds.includes(it.id)).map((it) => (
                      <SelectItem key={it.id} value={it.id}>[{it.code}] {it.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedItems.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedItems.map((it) => (
                      <Badge key={it.id} variant="secondary" className="gap-1 text-[12px] font-normal">
                        {it.name}
                        <button type="button" onClick={() => handleRemoveItem(it.id)} className="ml-0.5">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={handleSaveInfo} disabled={isSavingInfo}>
                {isSavingInfo ? "저장 중..." : "기본정보 저장"}
              </Button>

              <div className="pt-2 border-t flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground mr-1">상태 변경:</span>
                {(["ACTIVE", "INACTIVE", "MAINTENANCE"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={tool.status === s ? "default" : "outline"}
                    disabled={tool.status === "DISCARDED"}
                    onClick={() => handleChangeStatus(s)}
                  >
                    {STATUS_CONFIG[s].label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={tool.status === "DISCARDED" ? "default" : "outline"}
                  disabled={tool.status === "DISCARDED"}
                  className={tool.status !== "DISCARDED" ? "text-red-600 border-red-200 hover:bg-red-50" : ""}
                  onClick={() => handleChangeStatus("DISCARDED")}
                >
                  폐기
                </Button>
              </div>
            </div>

            {/* 수명 현황 */}
            <div className="rounded-lg border p-3 space-y-1.5">
              <p className="text-[13px] font-semibold text-muted-foreground">수명 현황</p>
              {tool.lifeLimit === null ? (
                <p className="text-[14px] text-muted-foreground">수명기준이 설정되지 않았습니다. 현재 사용량: {formatQuantity(tool.currentUsage)}회</p>
              ) : (
                <div className="text-[14px] space-y-0.5">
                  <p>수명: {formatQuantity(tool.lifeLimit)}회 · 현재: {formatQuantity(tool.currentUsage)}회</p>
                  <p className={tool.remainingLife !== null && tool.remainingLife < 0 ? "text-red-600 font-medium" : ""}>
                    잔여: {tool.remainingLife !== null ? formatQuantity(tool.remainingLife) : "-"}회 · 사용률: {tool.usageRate ?? "-"}%
                  </p>
                </div>
              )}
            </div>

            {/* 사용 이력 */}
            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">사용 이력</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {detail!.usageHistories.length === 0 && <p className="text-[13px] text-muted-foreground">등록된 사용이력이 없습니다.</p>}
                {detail!.usageHistories.map((u) => (
                  <div key={u.id} className="text-[13px] flex items-center justify-between border-b last:border-0 py-1">
                    <div><span>{u.usedAt.slice(0, 10)} · {formatQuantity(u.usageCount)}회{u.itemName ? ` · ${u.itemName}` : ""}{u.operatorName ? ` · ${u.operatorName}` : ""}{u.productionResultId ? ` · POP 실적 ${formatQuantity(u.productionQty ?? 0)}` : ""}</span>
                    {u.workOrderNo && <p className="text-muted-foreground" title={u.productionResultId ?? undefined}>{[u.workOrderNo, u.operationName, u.actualEquipmentName].filter(Boolean).join(" · ")}</p>}</div>
                    {u.note && <span className="text-muted-foreground truncate max-w-[140px]" title={u.note}>{u.note}</span>}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[12px]">사용일</Label>
                  <Input type="date" value={usedAt} onChange={(e) => setUsedAt(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">사용량 *</Label>
                  <Input type="number" min={1} value={usageCount} onChange={(e) => setUsageCount(e.target.value)} placeholder="예: 500" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">품목 (선택)</Label>
                  <Select value={usageItemId || NONE_VALUE} onValueChange={(v) => setUsageItemId(v === NONE_VALUE ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="선택 안 함" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>선택 안 함</SelectItem>
                      {filterOptions.items.map((it) => (
                        <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">작업자 (선택)</Label>
                  <Select value={usageOperatorId || NONE_VALUE} onValueChange={(v) => setUsageOperatorId(v === NONE_VALUE ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="선택 안 함" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>선택 안 함</SelectItem>
                      {filterOptions.operators.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea value={usageNote} onChange={(e) => setUsageNote(e.target.value)} placeholder="비고 (선택)" rows={2} />
              <Button size="sm" onClick={handleRegisterUsage} disabled={isSavingUsage}>
                {isSavingUsage ? "등록 중..." : "사용이력 등록"}
              </Button>
            </div>

            {/* 점검 이력 */}
            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">점검 이력</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {detail!.dailyChecks.length === 0 && <p className="text-[13px] text-muted-foreground">등록된 점검이력이 없습니다.</p>}
                {detail!.dailyChecks.map((c) => (
                  <div key={c.id} className="text-[13px] flex items-center justify-between border-b last:border-0 py-1">
                    <span>{new Date(c.checkDate).toISOString().slice(0, 10)} · {c.checker.name} · {CHECK_RESULT_LABEL[c.result] ?? c.result}</span>
                    {c.note && <span className="text-muted-foreground truncate max-w-[140px]" title={c.note}>{c.note}</span>}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[12px]">점검일</Label>
                  <Input type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">점검결과</Label>
                  <Select value={checkResult} onValueChange={(v) => setCheckResult(v as typeof checkResult)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PASS">합격</SelectItem>
                      <SelectItem value="FAIL">불합격</SelectItem>
                      <SelectItem value="NA">해당없음</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea value={checkNote} onChange={(e) => setCheckNote(e.target.value)} placeholder="점검내용/비고" rows={2} />
              <Button size="sm" onClick={handleRegisterCheck} disabled={isSavingCheck}>
                {isSavingCheck ? "등록 중..." : "점검이력 등록"}
              </Button>
            </div>

            {/* 수리 이력 */}
            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">수리 이력</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {detail!.repairRequests.length === 0 && <p className="text-[13px] text-muted-foreground">등록된 수리이력이 없습니다.</p>}
                {detail!.repairRequests.map((r) => (
                  <div key={r.id} className="text-[13px] flex items-center justify-between border-b last:border-0 py-1">
                    <span>{r.title} · {REPAIR_STATUS_LABEL[r.status] ?? r.status} · {REPAIR_PRIORITY_LABEL[r.priority] ?? r.priority}</span>
                    <span className="text-muted-foreground">{r.completedAt ? new Date(r.completedAt).toISOString().slice(0, 10) : "-"}</span>
                  </div>
                ))}
              </div>
              <Input value={repairTitle} onChange={(e) => setRepairTitle(e.target.value)} placeholder="수리내용(제목) *" />
              <Textarea value={repairDescription} onChange={(e) => setRepairDescription(e.target.value)} placeholder="상세 설명 (선택)" rows={2} />
              <div className="space-y-1">
                <Label className="text-[12px]">우선순위</Label>
                <Select value={repairPriority} onValueChange={(v) => setRepairPriority(v as typeof repairPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">낮음</SelectItem>
                    <SelectItem value="MEDIUM">보통</SelectItem>
                    <SelectItem value="HIGH">높음</SelectItem>
                    <SelectItem value="CRITICAL">긴급</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={handleRegisterRepair} disabled={isSavingRepair}>
                {isSavingRepair ? "등록 중..." : "수리요청 등록"}
              </Button>
            </div>
          </div>
        )}

        <SheetFooter className="pt-4 flex-row justify-between sm:justify-between">
          <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={handleDelete}>
            삭제
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
