"use client"

type Props = {
  featureCode: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function FeatureGate({ children }: Props) {
  return <>{children}</>
}
