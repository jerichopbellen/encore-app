import { createContext, useContext, useEffect, useState } from 'react'
import * as authApi from '../services/authApi'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isCurrent = true
    authApi.getCurrentUser()
      .then(({ data }) => {
        if (isCurrent) setUser(data.user)
      })
      .catch(() => {
        // A missing or expired cookie simply means the visitor is logged out.
        if (isCurrent) setUser(null)
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => { isCurrent = false }
  }, [])

  async function signIn(credentials) {
    const { data } = await authApi.login(credentials)
    setUser(data.user)
    return data.user
  }

  async function signOut() {
    await authApi.logout()
    setUser(null)
  }

  async function updateProfile(profile) {
    const { data } = await authApi.updateCurrentUser(profile)
    setUser(data.user)
    return data.user
  }

  const value = { user, isLoading, signIn, signOut, updateProfile }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The provider and hook live together so the session state has one clear home.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
