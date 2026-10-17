import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import * as authApi from '../services/authApi'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [authStatus, setAuthStatus] = useState('loading')
  const sessionRequestId = useRef(0)

  const requestSession = useCallback(async () => {
    try {
      const { data } = await authApi.getCurrentUser()
      return { status: 'authenticated', user: data.user }
    } catch (error) {
      // A 401 means the visitor has no valid session. Network and server
      // failures are kept separate so a temporary outage does not look logged out.
      return {
        status: error.status === 401 ? 'unauthenticated' : 'error',
        user: null,
      }
    }
  }, [])

  const applySession = useCallback(({ status, user: sessionUser }) => {
    setUser(sessionUser)
    setAuthStatus(status)
  }, [])

  const restoreSession = useCallback(async () => {
    const requestId = ++sessionRequestId.current
    setAuthStatus('loading')
    const result = await requestSession()
    if (requestId === sessionRequestId.current) applySession(result)
  }, [applySession, requestSession])

  useEffect(() => {
    const requestId = ++sessionRequestId.current
    let isCurrent = true
    requestSession().then((result) => {
      if (isCurrent && requestId === sessionRequestId.current) applySession(result)
    })

    return () => {
      isCurrent = false
      if (requestId === sessionRequestId.current) sessionRequestId.current += 1
    }
  }, [applySession, requestSession])

  async function signIn(credentials) {
    const { data } = await authApi.login(credentials)
    sessionRequestId.current += 1
    setUser(data.user)
    setAuthStatus('authenticated')
    return data.user
  }

  async function signOut() {
    await authApi.logout()
    sessionRequestId.current += 1
    setUser(null)
    setAuthStatus('unauthenticated')
  }

  async function updateProfile(profile) {
    const { data } = await authApi.updateCurrentUser(profile)
    setUser(data.user)
    return data.user
  }

  const value = {
    user,
    authStatus,
    isLoading: authStatus === 'loading',
    retrySession: restoreSession,
    signIn,
    signOut,
    updateProfile,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The provider and hook live together so the session state has one clear home.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
