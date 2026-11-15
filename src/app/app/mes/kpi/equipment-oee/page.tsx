import { redirect } from "next/navigation"

// 대원정밀 KPI 는 /app/mes/kpi 단일 화면에서 제공한다. (기존 준비중 화면은 대시보드로 이동)
export default function Page() {
  redirect("/app/mes/kpi?kpi=uph")
}
