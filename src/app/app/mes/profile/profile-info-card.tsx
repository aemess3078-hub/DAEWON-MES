"use client"

import { useState, useTransition } from "react"
import { UserRole } from "@prisma/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { updateMyProfile } from "@/lib/actions/profile.actions"
import type { MyProfileData } from "@/lib/actions/profile.actions"

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "오너",
  ADMIN: "관리자",
  MANAGER: "매니저",
  OPERATOR: "작업자",
  VIEWER: "조회자",
}

export function ProfileInfoCard({ profile }: { profile: MyProfileData }) {
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone ?? "")
  const [jobTitle, setJobTitle] = useState(profile.jobTitle ?? "")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await updateMyProfile({ name, phone, jobTitle })
      if (result.success) {
        setMessage({ type: "success", text: "계정정보가 저장되었습니다." })
      } else {
        setMessage({ type: "error", text: result.error ?? "저장에 실패했습니다." })
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[18px]">기본 정보</CardTitle>
        <CardDescription className="text-[13px]">
          이름, 연락처, 직급을 수정할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 읽기 전용 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[14px] text-muted-foreground">로그인 ID</Label>
              <Input value={profile.loginId} readOnly disabled className="bg-muted/40 text-[14px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px] text-muted-foreground">이메일</Label>
              <Input value={profile.email} readOnly disabled className="bg-muted/40 text-[14px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px] text-muted-foreground">권한</Label>
              <Input
                value={ROLE_LABELS[profile.role] ?? profile.role}
                readOnly
                disabled
                className="bg-muted/40 text-[14px]"
              />
            </div>
            {profile.department && (
              <div className="space-y-1.5">
                <Label className="text-[14px] text-muted-foreground">부서</Label>
                <Input value={profile.department} readOnly disabled className="bg-muted/40 text-[14px]" />
              </div>
            )}
          </div>

          {/* 수정 가능 */}
          <div className="pt-2 border-t">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name" className="text-[14px] font-medium">
                  이름 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="text-[14px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-phone" className="text-[14px] font-medium">
                  연락처
                </Label>
                <Input
                  id="profile-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  className="text-[14px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-jobTitle" className="text-[14px] font-medium">
                  직급 / 직책
                </Label>
                <Input
                  id="profile-jobTitle"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="예: 생산팀 과장"
                  className="text-[14px]"
                />
              </div>
            </div>
          </div>

          {message && (
            <p
              className={`text-[13px] rounded-lg px-3 py-2 ${
                message.type === "success"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
              }`}
            >
              {message.text}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending} className="h-9 px-5 text-[14px]">
              {isPending ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
