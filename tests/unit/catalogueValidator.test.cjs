const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCatalogueQuery, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../../server/src/validators/catalogueValidator')

test('catalogue query applies pagination, sorting, and filter defaults', () => {
  assert.deepEqual(normalizeCatalogueQuery({}), {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    search: '',
    availableOnly: false,
    sort: 'soonest',
  })
  assert.deepEqual(normalizeCatalogueQuery({
    page: '3', page_size: String(MAX_PAGE_SIZE), q: '  Jazz Hall  ', available: 'true', sort: 'latest',
  }), {
    page: 3,
    pageSize: MAX_PAGE_SIZE,
    search: 'Jazz Hall',
    availableOnly: true,
    sort: 'latest',
  })
})

test('catalogue query rejects invalid pagination, search, filters, sort, and unknown fields', () => {
  for (const query of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1e2' },
    { page_size: '0' },
    { page_size: String(MAX_PAGE_SIZE + 1) },
    { q: 'x'.repeat(101) },
    { q: ['music', 'sports'] },
    { available: 'yes' },
    { sort: 'price' },
    { category: 'concert' },
  ]) {
    assert.throws(() => normalizeCatalogueQuery(query), (error) => error.statusCode === 400)
  }
})
