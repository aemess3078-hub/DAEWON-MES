interface BrandLogoProps {
  size?: "sm" | "lg"
  className?: string
}

/**
 * 브랜드 로고 컴포넌트.
 * NEXT_PUBLIC_BRAND=newmes  → "NewMES" 텍스트 로고 (NMES 개발 서버용 분기, 유지)
 * 그 외(daewon 포함 기본값) → 대원정밀 임시 텍스트 로고
 *
 * TODO(DAEWON): 실제 대원정밀 로고 이미지가 확보되면 아래 기본 분기를
 * next/image 로 교체한다. (public/ 에 로고 파일 추가 후 <Image src="/logo-daewon.png" ... />)
 * size="sm" → 사이드바 / POP 헤더
 * size="lg" → 로그인 / 메인 화면
 */
export function BrandLogo({ size = "sm", className }: BrandLogoProps) {
  const isNewMes = process.env.NEXT_PUBLIC_BRAND === "newmes"

  if (isNewMes) {
    const textSize = size === "lg" ? "text-[38px]" : "text-[20px]"
    return (
      <div className={`flex items-baseline leading-none select-none ${textSize} ${className ?? ""}`}>
        <span className="font-light tracking-tight">New</span>
        <span className="font-bold tracking-tight">MES</span>
      </div>
    )
  }

  const textSize = size === "lg" ? "text-[34px]" : "text-[18px]"
  const subSize = size === "lg" ? "text-[15px]" : "text-[11px]"
  return (
    <div className={`flex flex-col leading-none select-none ${className ?? ""}`}>
      <span className={`font-bold tracking-tight ${textSize}`}>DAEWON PRECISION</span>
      <span className={`mt-1 font-medium tracking-wide opacity-80 ${subSize}`}>대원정밀 MES</span>
    </div>
  )
}
