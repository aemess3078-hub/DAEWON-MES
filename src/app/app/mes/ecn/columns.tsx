"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ECNWithDetails } from "@/lib/actions/ecn.actions"
import type { UserRole } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MoreHorizontal } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { format } from "date-fns"

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT:       { label: "초안",    className: "bg-muted text-muted-foreground border-border" },
  SUBMITTED:   { label: "제출됨",  className: "bg-blue-50 text-blue-700 border-blue-200" },
  REVIEWING:   { label: "검토중",  className: "bg-amber-50 text-amber-700 border-amber-200" },
  APPROVED:    { label: "승인됨",  className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  REJECTED:    { label: "반려됨",  className: "bg-red-50 text-red-700 border-red-200" },
  IMPLEMENTED: { label: "적용완료", className: "bg-purple-50 text-purple-700 border-purple-200" },
  CANCELLED:   { label: "취소됨",  className: "bg-gray-50 text-gray-500 border-gray-200" },
}

const CHANGE_TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  BOM:     { label: "BOM",        className: "bg-blue-50 text-blue-700 border-blue-200" },
  ROUTING: { label: "라우팅",      className: "bg-purple-50 text-purple-700 border-purple-200" },
  BOTH:    { label: "BOM+라우팅",  className: "bg-amber-50 text-amber-700 border-amber-200" },
}

interface ColOptions {
  onEdit: (ecn: ECNWithDetails) => void
  onDelete: (ecn: ECNWithDetails) => void
  onSubmit: (ecn: ECNWithDetails) => void
  onApprove: (ecn: ECNWithDetails) => void
  onReject: (ecn: ECNWithDetails) => void
  onImplement: (ecn: ECNWithDetails) => void
  isAdmin?: boolean
  userId: string
  userRole: UserRole
}

export function getColumns(options: ColOptions): ColumnDef<ECNWithDetails>[] {
  return [
    {
      accessorKey: "ecnNo",
      header: "ECN 번호",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-semibold text-primary">
          {row.original.ecnNo}
        </span>
      ),
    },
    {
      accessorKey: "title",
      header: "제목",
      cell: ({ row }) => (
        <span className="font-medium text-[14px]">{row.original.title}</span>
      ),
    },
    {
      id: "item",
      header: "대상 품목",
      cell: ({ row }) => (
        <div className="text-[13px]">
          <span className="font-mono text-muted-foreground">{row.original.item.code}</span>
          <span className="ml-1.5">{row.original.item.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "changeType",
      header: "변경유형",
      cell: ({ row }) => {
        const cfg = CHANGE_TYPE_CONFIG[row.original.changeType] ?? { label: row.original.changeType, className: "" }
        return (
          <Badge variant="outline" className={`text-[12px] ${cfg.className}`}>
            {cfg.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = STATUS_CONFIG[row.original.status] ?? { label: row.original.status, className: "" }
        return (
          <Badge variant="outline" className={`text-[12px] ${cfg.className}`}>
            {cfg.label}
          </Badge>
        )
      },
    },
    {
      id: "requester",
      header: "요청자",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{row.original.requester.name}</span>
      ),
    },
    {
      accessorKey: "requestedAt",
      header: "요청일",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {format(new Date(row.original.requestedAt), "yyyy-MM-dd")}
        </span>
      ),
    },
    {
      id: "approver",
      header: "승인자",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.approver?.name ?? "—"}
        </span>
      ),
    },
    {
      id: "details",
      header: "변경항목",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.details.length}건
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const ecn = row.original
        const { isAdmin = false, userId, userRole } = options
        const isOwnECN = ecn.requestedBy === userId
        const canOwnMutation = userRole === "OPERATOR" && isOwnECN
        const canEdit = isAdmin || (canOwnMutation && ["DRAFT", "SUBMITTED"].includes(ecn.status))
        const canDelete = isAdmin || (canOwnMutation && ["DRAFT", "SUBMITTED", "REVIEWING"].includes(ecn.status))
        const canSubmit = ecn.status === "DRAFT" && (isAdmin || canOwnMutation)
        // 승인/반려/적용은 관리자(MANAGER 이상)만 가능
        const canApprove = isAdmin && ["SUBMITTED", "REVIEWING"].includes(ecn.status)
        const canImplement = ["OWNER", "ADMIN"].includes(userRole) && ecn.status === "APPROVED"

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem onClick={() => options.onEdit(ecn)}>수정</DropdownMenuItem>
              )}
              {canSubmit && (
                <DropdownMenuItem onClick={() => options.onSubmit(ecn)}>
                  검토 제출
                </DropdownMenuItem>
              )}
              {canApprove && (
                <>
                  <DropdownMenuItem onClick={() => options.onApprove(ecn)}>승인</DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => options.onReject(ecn)}
                  >
                    반려
                  </DropdownMenuItem>
                </>
              )}
              {canImplement && (
                <DropdownMenuItem
                  className="text-emerald-600 font-semibold"
                  onClick={() => options.onImplement(ecn)}
                >
                  BOM/Routing에 적용
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => options.onDelete(ecn)}
                  >
                    삭제
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}
