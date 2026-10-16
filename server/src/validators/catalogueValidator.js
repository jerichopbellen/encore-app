const AppError = require('../utils/AppError')

const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 48
const MAX_SEARCH_LENGTH = 100
const SORT_OPTIONS = new Set(['soonest', 'latest', 'recently-added'])
const ALLOWED_QUERY_FIELDS = new Set(['page', 'page_size', 'q', 'available', 'sort'])

function positiveInteger(value, field, fallback, maximum) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new AppError(`${field} must be a positive whole number.`, 400)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || (maximum && parsed > maximum)) {
    throw new AppError(maximum
      ? `${field} must be between 1 and ${maximum}.`
      : `${field} must be a positive whole number.`, 400)
  }
  return parsed
}

function normalizeCatalogueQuery(query = {}) {
  const unknownField = Object.keys(query).find((field) => !ALLOWED_QUERY_FIELDS.has(field))
  if (unknownField) throw new AppError(`Unsupported catalogue query parameter: ${unknownField}.`, 400)

  const page = positiveInteger(query.page, 'page', 1)
  const pageSize = positiveInteger(query.page_size, 'page_size', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  if (query.q !== undefined && typeof query.q !== 'string') {
    throw new AppError('q must be a single text value.', 400)
  }
  const search = typeof query.q === 'string' ? query.q.trim() : ''
  if (search.length > MAX_SEARCH_LENGTH) {
    throw new AppError(`q must be ${MAX_SEARCH_LENGTH} characters or fewer.`, 400)
  }

  let availableOnly = false
  if (query.available !== undefined) {
    if (query.available !== 'true' && query.available !== 'false') {
      throw new AppError('available must be either true or false.', 400)
    }
    availableOnly = query.available === 'true'
  }

  const sort = query.sort === undefined ? 'soonest' : query.sort
  if (typeof sort !== 'string' || !SORT_OPTIONS.has(sort)) {
    throw new AppError('sort must be soonest, latest, or recently-added.', 400)
  }

  return { page, pageSize, search, availableOnly, sort }
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizeCatalogueQuery,
}
