import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceUrl = new URL('../components/desktop-runtime-bridge.shared.ts', import.meta.url)

test('hosted desktop hands native FastAPI the production backend, not loopback', async () => {
  const source = await readFile(sourceUrl, 'utf8')

  assert.match(source, /NEXT_PUBLIC_RITUAL_BACKEND_BASE_URL/)
  assert.match(source, /backend-api-production-a37e\.up\.railway\.app/)
  assert.match(source, /isLocalDashboardHost/)
  assert.match(source, /hostname === 'localhost'/)
  assert.doesNotMatch(
    source,
    /NEXT_PUBLIC_RITUAL_BACKEND_BASE_URL \|\| LOCAL_DESKTOP_BACKEND_BASE/,
  )
})
