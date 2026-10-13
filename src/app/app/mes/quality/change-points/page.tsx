export default function Page() {
  return (
    <div className="p-6 space-y-2">
      <h1 className="text-[26px] font-semibold text-foreground">변경점정보LIST</h1>
      <p className="text-[14px] text-muted-foreground">MES &gt; 품질검사</p>
      <div className="mt-8 p-8 rounded-lg border border-dashed border-border bg-muted/20 text-center">
        <p className="text-[15px] text-muted-foreground">등록된 변경점 정보 조회 및 이력 관리 화면입니다.</p>
        <span className="inline-block mt-3 px-3 py-1 rounded-full text-[13px] bg-muted text-muted-foreground">준비중</span>
      </div>
    </div>
  )
}
