export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { getMyProfile } from "@/lib/actions/profile.actions"
import { ProfileInfoCard } from "./profile-info-card"
import { PasswordChangeCard } from "./password-change-card"
import { PopPinChangeCard } from "./pop-pin-change-card"

export default async function ProfilePage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const profile = await getMyProfile()
  if (!profile) redirect("/login")

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-[26px] font-bold leading-tight">내 계정정보</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          내 프로필 정보를 확인하고 수정합니다
        </p>
      </div>
      <ProfileInfoCard profile={profile} />
      <PasswordChangeCard />
      <PopPinChangeCard />
    </div>
  )
}
