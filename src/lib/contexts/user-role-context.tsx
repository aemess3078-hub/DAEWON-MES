"use client"

import { createContext, useContext } from "react"
import type { UserRole } from "@prisma/client"

const UserRoleContext = createContext<UserRole>("VIEWER")

export function UserRoleProvider({
  role,
  children,
}: {
  role: UserRole
  children: React.ReactNode
}) {
  return <UserRoleContext.Provider value={role}>{children}</UserRoleContext.Provider>
}

export function useUserRole(): UserRole {
  return useContext(UserRoleContext)
}
