import { getAttachments, type AttachmentFilter } from "@/lib/actions/attachment.actions"
import { ATTACHMENT_ENTITY_TYPES, type AttachmentEntityType } from "@/lib/actions/attachment.helpers"
import { AttachmentsClient } from "./attachments-client"

export const dynamic = "force-dynamic"

interface AttachmentsPageProps {
  searchParams?: Promise<{
    entityType?: string
    extension?: string
    from?: string
    to?: string
  }>
}

const VALID_ENTITY_TYPES = new Set<string>(ATTACHMENT_ENTITY_TYPES)

export default async function AttachmentsPage({ searchParams }: AttachmentsPageProps) {
  const params = searchParams ? await searchParams : {}

  const filter: AttachmentFilter = {
    entityType:
      params.entityType && VALID_ENTITY_TYPES.has(params.entityType)
        ? (params.entityType as AttachmentEntityType)
        : undefined,
    extension: params.extension?.trim() || undefined,
    from: params.from?.trim() || undefined,
    to: params.to?.trim() || undefined,
  }

  const rows = await getAttachments(filter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          첨부파일관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          MES 업무 데이터에 연결된 첨부파일을 조회합니다. 업로드/삭제는 각 업무 상세 화면에서 진행합니다.
        </p>
      </div>

      <AttachmentsClient
        initialFilter={{
          entityType: filter.entityType ?? "",
          extension: filter.extension ?? "",
          from: filter.from ?? "",
          to: filter.to ?? "",
        }}
        rows={rows}
      />
    </div>
  )
}
