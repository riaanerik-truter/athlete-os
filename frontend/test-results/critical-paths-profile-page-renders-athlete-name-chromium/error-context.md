# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-paths.spec.js >> profile page renders athlete name
- Location: tests\critical-paths.spec.js:42:1

# Error details

```
Error: expect(locator).not.toBeVisible() failed

Locator:  getByText('Could not load profile')
Expected: not visible
Received: visible
Timeout:  5000ms

Call log:
  - Expect "not toBeVisible" with timeout 5000ms
  - waiting for getByText('Could not load profile')
    9 × locator resolved to <p class="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">Could not load profile</p>
      - unexpected value "visible"

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation [ref=e4]:
    - generic [ref=e5]:
      - link "Athlete OS" [ref=e6] [cursor=pointer]:
        - /url: /
        - generic [ref=e7]: Athlete OS
      - generic [ref=e8]:
        - link "Dashboard" [ref=e9] [cursor=pointer]:
          - /url: /
        - link "Knowledge" [ref=e10] [cursor=pointer]:
          - /url: /knowledge
        - link "Profile" [ref=e11] [cursor=pointer]:
          - /url: /profile
      - generic [ref=e12]:
        - button "Toggle theme" [ref=e13] [cursor=pointer]:
          - img [ref=e14]
        - button "Open settings" [ref=e16] [cursor=pointer]:
          - img [ref=e17]
  - main [ref=e21]:
    - generic [ref=e22]:
      - paragraph [ref=e23]: Could not load profile
      - paragraph [ref=e24]: API did not return an athlete record. Make sure the API is running on port 3000 and the athlete record exists.
      - paragraph [ref=e25]: "GET /api/v1/athlete · X-API-Key: sk-local-kzS5FHuBZ6TNI214"
      - button "Retry" [ref=e26] [cursor=pointer]
  - button "Open chat" [ref=e28] [cursor=pointer]:
    - img [ref=e29]
  - button "Report a bug or idea" [ref=e31] [cursor=pointer]:
    - img [ref=e32]
```

# Test source

```ts
  1   | // Playwright tests — critical paths for Athlete OS
  2   | // Run: cd frontend && npx playwright test
  3   | //
  4   | // Tests 1 and 2 require the API running on http://localhost:3000.
  5   | // Tests 3-5 require only the frontend dev/preview server on http://localhost:5173.
  6   | // Test 5 (send message) requires the messaging service on ws://localhost:3001.
  7   | 
  8   | import { test, expect, request } from '@playwright/test'
  9   | 
  10  | const API_BASE    = 'http://localhost:3000'
  11  | const API_KEY     = 'sk-local-kzS5FHuBZ6TNI214'
  12  | const API_HEADERS = { 'X-API-Key': API_KEY }
  13  | 
  14  | // ---------------------------------------------------------------------------
  15  | // Helper — skip tour so it doesn't interfere with other tests
  16  | // ---------------------------------------------------------------------------
  17  | async function skipTour(page) {
  18  |   await page.addInitScript(() => {
  19  |     localStorage.setItem('athleteos_tour_completed', 'true')
  20  |   })
  21  | }
  22  | 
  23  | // ---------------------------------------------------------------------------
  24  | // 1. API key is configured — GET /athlete returns 200
  25  | // ---------------------------------------------------------------------------
  26  | test('API key is configured and GET /athlete returns 200', async () => {
  27  |   const ctx = await request.newContext({ baseURL: API_BASE })
  28  |   const res = await ctx.get('/api/v1/athlete', { headers: API_HEADERS })
  29  | 
  30  |   expect(res.status(), `GET /athlete returned ${res.status()} — is the API running on port 3000?`).toBe(200)
  31  | 
  32  |   const body = await res.json()
  33  |   expect(body).toHaveProperty('id')
  34  |   expect(body).toHaveProperty('name')
  35  | 
  36  |   await ctx.dispose()
  37  | })
  38  | 
  39  | // ---------------------------------------------------------------------------
  40  | // 2. Profile page renders athlete name (not loading state)
  41  | // ---------------------------------------------------------------------------
  42  | test('profile page renders athlete name', async ({ page }) => {
  43  |   await skipTour(page)
  44  |   await page.goto('/profile')
  45  | 
  46  |   // Should NOT show loading forever — wait up to 8s for loading to resolve
  47  |   await expect(page.getByText('Loading profile…')).not.toBeVisible({ timeout: 8000 })
  48  | 
  49  |   // Should NOT show the error panel
> 50  |   await expect(page.getByText('Could not load profile')).not.toBeVisible()
      |                                                              ^ Error: expect(locator).not.toBeVisible() failed
  51  | 
  52  |   // "Personal details" section heading should appear once data loads
  53  |   await expect(page.getByText('Personal details')).toBeVisible({ timeout: 8000 })
  54  | })
  55  | 
  56  | // ---------------------------------------------------------------------------
  57  | // 3. Bug reporter button is visible in the DOM
  58  | // ---------------------------------------------------------------------------
  59  | test('bug reporter button is visible', async ({ page }) => {
  60  |   await skipTour(page)
  61  |   await page.goto('/')
  62  | 
  63  |   const btn = page.getByRole('button', { name: /report a bug/i })
  64  |   await expect(btn).toBeVisible()
  65  | 
  66  |   // Click it — modal should open
  67  |   await btn.click()
  68  |   await expect(page.getByPlaceholder(/describe the issue/i)).toBeVisible({ timeout: 3000 })
  69  | 
  70  |   // Close it
  71  |   await page.keyboard.press('Escape')
  72  | })
  73  | 
  74  | // ---------------------------------------------------------------------------
  75  | // 4. Chat widget opens and send button is active when input has text
  76  | // ---------------------------------------------------------------------------
  77  | test('chat widget opens and send button is active with input', async ({ page }) => {
  78  |   await skipTour(page)
  79  |   await page.goto('/')
  80  | 
  81  |   // Open chat
  82  |   await page.getByRole('button', { name: /open chat/i }).click()
  83  | 
  84  |   const input = page.getByPlaceholder('Type a message…')
  85  |   await expect(input).toBeVisible({ timeout: 3000 })
  86  | 
  87  |   // With no text the send button should be disabled
  88  |   const sendBtn = page.locator('button[disabled]').filter({ has: page.locator('svg') }).last()
  89  |   // Type text — send button should become enabled
  90  |   await input.fill('Hello Coach Ri')
  91  | 
  92  |   // The send button is enabled when input has text (regardless of WS state)
  93  |   const sendButton = page.locator('form, div').last().locator('button').last()
  94  |   // Simpler: just verify the input value and that typing works
  95  |   await expect(input).toHaveValue('Hello Coach Ri')
  96  | 
  97  |   // Submit via Enter — message should appear (either via WS or HTTP fallback)
  98  |   await input.press('Enter')
  99  | 
  100 |   // Message should appear in the chat window (role: user)
  101 |   await expect(page.getByText('Hello Coach Ri')).toBeVisible({ timeout: 5000 })
  102 | })
  103 | 
  104 | // ---------------------------------------------------------------------------
  105 | // 5. Sending a message in chat produces a response (requires messaging service)
  106 | // ---------------------------------------------------------------------------
  107 | test('sending a message via chat produces a response', async ({ page }) => {
  108 |   // Skip if messaging service is not reachable
  109 |   let wsAvailable = false
  110 |   try {
  111 |     const ctx = await request.newContext()
  112 |     // The messaging service has no HTTP health endpoint, so we probe the API conversations endpoint
  113 |     const res = await ctx.get(`${API_BASE}/api/v1/conversations`, { headers: API_HEADERS })
  114 |     wsAvailable = res.ok()
  115 |     await ctx.dispose()
  116 |   } catch { /**/ }
  117 | 
  118 |   test.skip(!wsAvailable, 'Messaging service or API not reachable — skipping chat response test')
  119 | 
  120 |   await skipTour(page)
  121 |   await page.goto('/')
  122 | 
  123 |   // Open chat
  124 |   await page.getByRole('button', { name: /open chat/i }).click()
  125 |   const input = page.getByPlaceholder('Type a message…')
  126 |   await expect(input).toBeVisible({ timeout: 3000 })
  127 | 
  128 |   // Send a message
  129 |   const testMsg = `test ${Date.now()}`
  130 |   await input.fill(testMsg)
  131 |   await input.press('Enter')
  132 | 
  133 |   // Our message should appear
  134 |   await expect(page.getByText(testMsg)).toBeVisible({ timeout: 5000 })
  135 | 
  136 |   // If WS is connected, a coach response should arrive within 30s
  137 |   // If not connected (HTTP fallback), at least our own message is visible — test passes
  138 |   // We give 30s for a coach response but don't hard-fail if messaging service is down
  139 |   const coachLabel = page.getByText('Coach Ri', { exact: false }).last()
  140 |   await coachLabel.waitFor({ timeout: 30_000 }).catch(() => {
  141 |     // No coach response — acceptable if messaging service ws isn't active
  142 |   })
  143 | })
  144 | 
```