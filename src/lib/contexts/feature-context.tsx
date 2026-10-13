"use client"

import { createContext, useContext } from "react"

const FeatureContext = createContext<string[]>([])

export function FeatureProvider({
  children,
  enabledFeatures,
}: {
  children: React.ReactNode
  enabledFeatures: string[]
}) {
  return (
    <FeatureContext.Provider value={enabledFeatures}>
      {children}
    </FeatureContext.Provider>
  )
}

export function useFeature(code: string): boolean {
  const features = useContext(FeatureContext)
  return features.includes(code)
}

export function useFeatures(): string[] {
  return useContext(FeatureContext)
}
