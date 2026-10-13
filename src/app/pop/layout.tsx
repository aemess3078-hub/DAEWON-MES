export const dynamic = "force-dynamic"

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

export default async function PopLayout({ children }: { children: React.ReactNode }) {
  // POP 페이지는 로그인 화면 표시를 위해 세션 없이도 렌더링 허용.
  // 개별 데이터 액션에서 auth context를 검사하므로 무인증 상태에서 데이터는 반환되지 않는다.
  // 세션이 있고 mustChangePw=true이면 비밀번호 변경 화면으로 강제 이동.
  const user = await getCurrentUser()
  if (user?.mustChangePw) {
    redirect('/auth/change-password')
  }

  return (
    <div className="h-screen overflow-y-auto bg-slate-100" style={{ fontSize: "18px" }}>
      {children}
    </div>
  )
}
