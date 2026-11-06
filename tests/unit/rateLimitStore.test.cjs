const assert = require('node:assert/strict')
const test = require('node:test')
const { BoundedMemoryStore, REFUSED_HITS } = require('../../server/src/middleware/boundedMemoryStore')

function createStore(options = {}) {
  const clock = { now: 1_000_000 }
  const store = new BoundedMemoryStore({ now: () => clock.now, sweepIntervalMs: 0, ...options })
  store.init({ windowMs: 1000 })
  return { store, clock }
}

test('increment counts hits per key and reports when the window resets', async () => {
  const { store, clock } = createStore()
  assert.equal((await store.increment('a')).totalHits, 1)
  assert.equal((await store.increment('a')).totalHits, 2)
  assert.equal((await store.increment('b')).totalHits, 1)
  assert.equal((await store.get('a')).resetTime.getTime(), clock.now + 1000)
})

test('a counter starts over once its window has passed, without waiting in real time', async () => {
  const { store, clock } = createStore()
  await store.increment('a')
  await store.increment('a')
  clock.now += 999
  assert.equal((await store.increment('a')).totalHits, 3)
  clock.now += 2
  assert.equal(await store.get('a'), undefined)
  assert.equal((await store.increment('a')).totalHits, 1)
})

test('decrement lowers a counter and deletes it at zero so it stops using capacity', async () => {
  const { store } = createStore()
  await store.increment('a')
  await store.increment('a')
  await store.decrement('a')
  assert.equal((await store.get('a')).totalHits, 1)
  await store.decrement('a')
  assert.equal(await store.get('a'), undefined)
  assert.equal(store.size, 0)
  await store.decrement('never-seen') // harmless
})

test('resetKey and resetAll remove counters', async () => {
  const { store } = createStore()
  await store.increment('a')
  await store.increment('b')
  await store.resetKey('a')
  assert.equal(await store.get('a'), undefined)
  await store.resetAll()
  assert.equal(store.size, 0)
})

test('sweepExpired removes only expired counters', async () => {
  const { store, clock } = createStore()
  await store.increment('old')
  clock.now += 600
  await store.increment('newer')
  clock.now += 500 // old is past its window, newer is not
  store.sweepExpired()
  assert.equal(store.size, 1)
  assert.ok(await store.get('newer'))
})

test('a locked key stays locked after a flood of unique keys', async () => {
  const { store } = createStore({ maxKeys: 20 })
  for (let i = 0; i < 6; i += 1) await store.increment('victim')
  for (let i = 0; i < 500; i += 1) await store.increment(`attacker-${i}`)
  assert.equal((await store.get('victim')).totalHits, 6)
  assert.equal((await store.increment('victim')).totalHits, 7)
})

test('the store never exceeds its configured capacity', async () => {
  const { store } = createStore({ maxKeys: 10 })
  for (let i = 0; i < 1000; i += 1) {
    await store.increment(`key-${i}`)
    assert.ok(store.size <= 10, `store held ${store.size} keys`)
  }
  assert.equal(store.size, 10)
})

test('a new key is refused when the store is full of live counters, and nothing is stored for it', async () => {
  const { store, clock } = createStore({ maxKeys: 3 })
  await store.increment('a')
  clock.now += 100
  await store.increment('b')
  await store.increment('c')

  const refused = await store.increment('d')
  assert.equal(refused.totalHits, REFUSED_HITS)
  // Retry-After points at the earliest expiry (counter "a").
  assert.equal(refused.resetTime.getTime(), 1_000_000 + 1000)
  assert.equal(await store.get('d'), undefined)
  assert.equal(store.size, 3)
  assert.equal(store.refusedNewKeys, 1)
})

test('refusing new keys does not reset or weaken existing counters', async () => {
  const { store } = createStore({ maxKeys: 3 })
  await store.increment('a')
  await store.increment('a')
  await store.increment('b')
  await store.increment('c')
  const before = [await store.get('a'), await store.get('b'), await store.get('c')]

  for (let i = 0; i < 50; i += 1) await store.increment(`flood-${i}`)

  const after = [await store.get('a'), await store.get('b'), await store.get('c')]
  assert.deepEqual(after.map((entry) => entry.totalHits), [2, 1, 1])
  assert.deepEqual(after.map((entry) => entry.resetTime.getTime()), before.map((entry) => entry.resetTime.getTime()))
  // A refused key's later decrement cannot reduce anyone else's counter.
  await store.decrement('flood-0')
  assert.equal((await store.get('a')).totalHits, 2)
})

test('expired counters are reclaimed so new keys are accepted again', async () => {
  const { store, clock } = createStore({ maxKeys: 3 })
  await store.increment('a')
  await store.increment('b')
  await store.increment('c')
  assert.equal((await store.increment('d')).totalHits, REFUSED_HITS)

  clock.now += 1001
  assert.equal((await store.increment('d')).totalHits, 1)
  assert.equal(store.size, 1)
})

test('only the expired counters are reclaimed; live ones are kept', async () => {
  const { store, clock } = createStore({ maxKeys: 3 })
  await store.increment('a')
  clock.now += 600
  await store.increment('b')
  await store.increment('c')
  clock.now += 500 // a expired, b and c live
  assert.equal((await store.increment('d')).totalHits, 1)
  assert.equal(await store.get('a'), undefined)
  assert.equal((await store.get('b')).totalHits, 1)
  assert.equal((await store.get('c')).totalHits, 1)
  assert.equal(store.size, 3)
})

test('counters given back to zero do not fill the store', async () => {
  const { store } = createStore({ maxKeys: 3 })
  for (let i = 0; i < 100; i += 1) {
    await store.increment(`user-${i}`)
    await store.decrement(`user-${i}`)
  }
  assert.equal(store.size, 0)
  assert.equal(store.refusedNewKeys, 0)
})

test('the periodic sweep timer does not keep the process alive and shutdown clears it', () => {
  const store = new BoundedMemoryStore({ sweepIntervalMs: 50 })
  store.init({ windowMs: 1000 })
  assert.ok(store.timer)
  assert.equal(store.timer.hasRef(), false)
  store.shutdown()
  assert.equal(store.timer, null)
})
