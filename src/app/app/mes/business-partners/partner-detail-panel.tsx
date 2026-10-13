"use client"

import { X, Building2, User, Phone, Mail, MapPin, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BusinessPartner } from "@/lib/actions/business-partner.actions"

const PARTNER_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: "고객사",
  SUPPLIER: "거래처",
  BOTH: "고객사 + 거래처",
}

type Props = {
  partner: BusinessPartner
  onClose: () => void
}

function DetailItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {value ? (
        <span className="text-[14px] text-foreground break-words">{value}</span>
      ) : (
        <span className="text-[14px] text-muted-foreground/50">—</span>
      )}
    </div>
  )
}

export function PartnerDetailPanel({ partner, onClose }: Props) {
  const typeLabel = PARTNER_TYPE_LABELS[partner.partnerType] ?? partner.partnerType
  const isActive = partner.status === "ACTIVE"

  return (
    <div className="border rounded-xl overflow-hidden shadow-sm animate-in slide-in-from-top-2 duration-200">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-4 bg-muted/20 border-b">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[15px] font-bold text-primary">{partner.code}</span>
          <span className="text-[15px] font-semibold">{partner.name}</span>
          <span className="text-[12px] text-muted-foreground border rounded px-1.5 py-0.5">
            {typeLabel}
          </span>
          <span
            className={`text-[12px] px-2 py-0.5 rounded-full border font-medium ${
              isActive
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {isActive ? "활성" : "비활성"}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* 상세 정보 그리드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 px-5 py-4 bg-background">
        <DetailItem
          icon={<Building2 className="w-3.5 h-3.5" />}
          label="사업자등록번호"
          value={partner.businessNumber}
        />
        <DetailItem
          icon={<User className="w-3.5 h-3.5" />}
          label="대표자명"
          value={partner.ceoName}
        />
        <DetailItem
          icon={<Phone className="w-3.5 h-3.5" />}
          label="전화번호"
          value={partner.phone}
        />
        <DetailItem
          icon={<Mail className="w-3.5 h-3.5" />}
          label="이메일1"
          value={partner.email}
        />
        <DetailItem
          icon={<Mail className="w-3.5 h-3.5" />}
          label="이메일2"
          value={partner.email2}
        />
        <DetailItem
          icon={<MapPin className="w-3.5 h-3.5" />}
          label="주소"
          value={partner.address}
        />
        <DetailItem
          icon={<User className="w-3.5 h-3.5" />}
          label="담당자명"
          value={partner.contactName}
        />
        <DetailItem
          icon={<Phone className="w-3.5 h-3.5" />}
          label="담당자연락처"
          value={partner.contactPhone}
        />
        <DetailItem
          icon={<FileText className="w-3.5 h-3.5" />}
          label="비고"
          value={partner.remark}
        />
      </div>
    </div>
  )
}
