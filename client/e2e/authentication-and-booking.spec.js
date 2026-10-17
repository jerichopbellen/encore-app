import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import process from 'node:process'

const runId = process.env.E2E_RUN_ID
const customerPassword = `Encore-e2e-${runId}-Password!`
const eventId = process.env.E2E_EVENT_ID
const reservationEventTitle = `Encore E2E ${runId} Reservation Night`

async function enterPassword(page, password) {
  const passwordInput = page.getByLabel('Password')
  await expect(passwordInput).toBeVisible()
  await expect(passwordInput).toBeEnabled()

  // locator.fill() includes its value in Playwright's action log. Set the
  // controlled React input through evaluate instead, whose call log omits args.
  await passwordInput.evaluate((input, value) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setValue) throw new Error('Could not set the password input.')
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, password)
}

async function registerCustomer(page, suffix) {
  const email = `encore-e2e-${runId}-${suffix}-${randomUUID()}@example.test`
  await page.goto('/register')
  await page.getByLabel('Name').fill(`E2E Customer ${suffix}`)
  await page.getByLabel('Email').fill(email)
  await enterPassword(page, customerPassword)
  const registrationResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/register') && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Create account' }).click()
  expect((await registrationResponse).status()).toBe(201)
  await expect(page.getByRole('status')).toContainText('Your account is ready')
  return email
}

async function login(page, email, password) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await enterPassword(page, password)
  const loginResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/login') && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Log in' }).click()
  expect((await loginResponse).status()).toBe(200)
}

test('customer login persists after refresh through /api/auth/me', async ({ page }) => {
  const email = await registerCustomer(page, 'session')
  await login(page, email, customerPassword)
  await expect(page.getByRole('button', { name: 'My Account' })).toBeVisible()

  const sessionResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/me') && response.request().method() === 'GET'
  ))
  await page.reload()
  expect((await sessionResponse).status()).toBe(200)
  await expect(page.getByRole('button', { name: 'My Account' })).toBeVisible()
})

test('direct navigation to an account page redirects a signed-out visitor to login', async ({ page }) => {
  const sessionResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/me') && response.request().method() === 'GET'
  ))
  await page.goto('/account/reservations')
  expect((await sessionResponse).status()).toBe(401)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
})

test('a signed-in customer is denied the admin event route', async ({ page }) => {
  const email = await registerCustomer(page, 'authorization')
  await login(page, email, customerPassword)
  await page.goto('/admin/events')

  await expect(page.getByRole('alert')).toContainText('Administrator access is required.')
  await expect(page).toHaveURL(/\/admin\/events$/)
})

test('an administrator can create an event and see it in its workspace', async ({ page }) => {
  await login(page, process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD)
  const title = `Encore E2E ${runId} Admin Created ${randomUUID().slice(0, 8)}`
  const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const localDateTime = new Date(future.getTime() - future.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)

  await page.goto('/admin/events/new')
  await page.getByLabel('Event title').fill(title)
  await page.getByLabel('Venue').fill('Encore E2E Test Hall')
  await page.getByLabel('Date and time').fill(localDateTime)
  await page.getByLabel(/Description/).fill('A browser test event fixture.')
  await page.getByRole('button', { name: 'Create event' }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]+$/i)
})

test('a customer can reserve tickets, complete simulated checkout, and view the booking', async ({ page }) => {
  const email = await registerCustomer(page, 'booking')
  await login(page, email, customerPassword)
  await page.goto(`/events/${eventId}`)
  await expect(page.getByRole('heading', { name: reservationEventTitle })).toBeVisible()
  await page.getByLabel('Ticket type').selectOption({ label: 'General Admission' })
  await page.getByLabel('Quantity').fill('2')
  await page.getByRole('button', { name: 'Reserve tickets' }).click()
  await expect(page.getByRole('status')).toContainText('Tickets reserved')
  await page.getByRole('link', { name: 'View my reservations' }).click()
  await expect(page.getByRole('heading', { name: reservationEventTitle })).toBeVisible()
  await page.getByRole('link', { name: 'Review checkout' }).click()
  await expect(page.getByRole('heading', { name: 'Review your tickets' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm simulated checkout' }).click()

  await expect(page.getByRole('heading', { name: 'You’re going!' })).toBeVisible()
  await expect(page.getByRole('heading', { name: reservationEventTitle })).toBeVisible()
  await expect(page.getByText('2 × General Admission')).toBeVisible()
})

test('logout clears the session and protected pages remain unavailable after reload', async ({ page }) => {
  const email = await registerCustomer(page, 'logout')
  await login(page, email, customerPassword)
  await page.getByRole('button', { name: 'My Account' }).click()
  const logoutResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/logout') && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Log out' }).click()
  expect((await logoutResponse).status()).toBe(200)
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible()

  const unauthenticatedSessionResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/me') && response.request().method() === 'GET'
  ))
  await page.goto('/account/reservations')
  expect((await unauthenticatedSessionResponse).status()).toBe(401)
  await expect(page).toHaveURL(/\/login$/)
})
