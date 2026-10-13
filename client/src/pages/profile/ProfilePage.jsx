import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'

function getInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    return `${Array.from(words[0])[0]}${Array.from(words.at(-1))[0]}`.toLocaleUpperCase()
  }
  return Array.from(words[0] || '—').slice(0, 2).join('').toLocaleUpperCase()
}

function ProfilePage() {
  const { user, isLoading, updateProfile } = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')

  if (isLoading) {
    return <p className="profile-state" role="status">Checking your session…</p>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  async function handleSave(event) {
    event.preventDefault()
    const name = draftName.trim()
    setErrorMessage('')
    setNotice('')

    if (!name) {
      setErrorMessage('Enter a name before saving.')
      return
    }
    if (name.length > 100) {
      setErrorMessage('Your name must be 100 characters or fewer.')
      return
    }

    setIsSaving(true)
    try {
      await updateProfile({ name })
      setDraftName(null)
      setIsEditing(false)
      setNotice('Your profile has been updated.')
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    setDraftName(null)
    setIsEditing(false)
    setErrorMessage('')
    setNotice('')
  }

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <header className="profile-page__heading">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1 id="profile-title">My profile</h1>
        <p className="profile-page__intro">Manage the details connected to your Encore account.</p>
      </header>

      <div className="profile-card">
        <div className="profile-card__identity">
          <div className="profile-avatar" aria-hidden="true">{getInitials(user.name)}</div>
          <div className="profile-card__identity-copy">
            <p className="profile-card__label">Encore account</p>
            <h2>{user.name}</h2>
          </div>
        </div>

        <div className="profile-card__divider" />

        {isEditing ? (
          <form className="auth-form profile-form" onSubmit={handleSave}>
            <div className="profile-card__details">
              <label className="profile-field" htmlFor="profile-name">
                <span className="profile-field__label">Name</span>
                <input
                  id="profile-name"
                  name="name"
                  type="text"
                  maxLength={100}
                  autoComplete="name"
                  value={draftName ?? user.name}
                  onChange={(event) => setDraftName(event.target.value)}
                  aria-invalid={Boolean(errorMessage)}
                  aria-describedby={errorMessage ? 'profile-error' : undefined}
                  required
                />
              </label>
              <div className="profile-field">
                <span className="profile-field__label">Email</span>
                <span className="profile-field__value">{user.email}</span>
              </div>
            </div>
            <div className="profile-page__actions">
              <button className="button-link profile-page__save" type="submit" disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save changes'}
              </button>
              <button className="profile-page__cancel" type="button" onClick={handleCancel} disabled={isSaving}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className="profile-card__details">
              <div className="profile-field">
                <dt className="profile-field__label">Name</dt>
                <dd className="profile-field__value">{user.name}</dd>
              </div>
              <div className="profile-field">
                <dt className="profile-field__label">Email</dt>
                <dd className="profile-field__value">{user.email}</dd>
              </div>
            </dl>
            <button
              className="button-link profile-page__edit"
              type="button"
              onClick={() => {
                setDraftName(user.name)
                setIsEditing(true)
                setNotice('')
                setErrorMessage('')
              }}
            >
              Edit name
            </button>
          </>
        )}
        {errorMessage && <p className="auth-form__error profile-page__message" id="profile-error" role="alert">{errorMessage}</p>}
        {notice && <p className="auth-form__notice" role="status">{notice}</p>}
      </div>
      <Link className="profile-page__back" to="/">Back to events</Link>
    </section>
  )
}

export default ProfilePage
