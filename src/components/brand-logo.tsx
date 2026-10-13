import Image from "next/image"

interface BrandLogoProps {
  size?: "sm" | "lg"
  /**
   * 로고가 놓이는 배경.
   * - "light"(기본): 밝은 배경 — 로고를 그대로 표시
   * - "onDark": 어두운 배경(POP 헤더 등) — 파란 글자의 대비를 위해 흰색 칩 위에 표시
   */
  tone?: "light" | "onDark"
  className?: string
}

/** public/brand/daewon-logo.png (960x179, 투명 배경) */
const DAEWON_LOGO_SRC = "/brand/daewon-logo.png"
const DAEWON_LOGO_WIDTH = 960
const DAEWON_LOGO_HEIGHT = 179

/**
 * 브랜드 로고 컴포넌트.
 * NEXT_PUBLIC_BRAND=newmes  → "NewMES" 텍스트 로고 (NMES 개발 서버용 분기, 유지)
 * 그 외(daewon 포함 기본값) → 대원정밀 로고 이미지
 *
 * size="sm" → 사이드바 / POP 헤더
 * size="lg" → 로그인 / 메인 화면
 *
 * 로고는 이미 최적 크기(960px)의 정적 PNG 이므로 이미지 최적화(/_next/image)는 사용하지 않는다.
 */
export function BrandLogo({ size = "sm", tone = "light", className }: BrandLogoProps) {
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

  const heightClass = size === "lg" ? "h-[52px]" : "h-7"
  const chipClass =
    tone === "onDark"
      ? "rounded-md bg-white px-2.5 py-1.5"
      : "dark:rounded-md dark:bg-white dark:px-2 dark:py-1"

  return (
    <div className={`inline-flex select-none ${chipClass} ${className ?? ""}`}>
      <Image
        src={DAEWON_LOGO_SRC}
        alt="대원정밀 DAEWON"
        width={DAEWON_LOGO_WIDTH}
        height={DAEWON_LOGO_HEIGHT}
        className={`w-auto ${heightClass}`}
        priority={size === "lg"}
        unoptimized
        draggable={false}
      />
    </div>
  )
}
