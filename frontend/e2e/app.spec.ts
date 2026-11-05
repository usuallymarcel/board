import { expect, test as base, type Browser, type Page } from '@playwright/test'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
let counter = 0
const unique = (name: string) => `${name}-${Date.now().toString(36)}-${++counter}`

/** Every page must load without a CSP violation, console error or uncaught exception. */
const test = base.extend<{ problems: string[] }>({
  problems: [async ({ page }, use) => {
    const problems: string[] = []
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      const text = m.text()
      // Expected refusals (wrong password, gone link) show as failed fetches.
      if (m.type() === 'error' && !/Failed to load resource/.test(text)) problems.push(`console: ${text}`)
    })
    await use(problems)
    expect(problems).toEqual([])
  }, { auto: true }],
})

async function signUp(page: Page, name = unique('user')) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New here? Create an account' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Password').fill('password-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: `Hello, ${name}` })).toBeVisible()
  return name
}

async function newContext(browser: Browser) {
  return (await browser.newContext({ baseURL: 'http://localhost:8099' })).newPage()
}

async function pasteImage(page: Page, selector: string) {
  await page.locator(selector).evaluate((el, bytes) => {
    const file = new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' })
    const data = new DataTransfer()
    data.items.add(file)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, [...PNG])
}

async function newNote(page: Page) {
  await page.getByRole('button', { name: 'New note' }).first().click()
  await expect(page.getByLabel('Note title')).toBeVisible()
}

test('guests get the login page but can read the forum', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
  await page.getByRole('link', { name: 'Browse the public forum' }).click()
  await expect(page.getByRole('heading', { name: 'Forum' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in to post' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Notes' })).toHaveCount(0)
})

test('a note autosaves, renders markdown, takes pasted images and ticks checkboxes', async ({ page }) => {
  await signUp(page)
  await newNote(page)
  await page.getByLabel('Note title').fill('Plans')
  const text = page.getByRole('textbox', { name: 'Note text' })
  await text.fill('# Heading\n\n**bold** text\n\n- [ ] first\n- [ ] second\n\n')
  await expect(page.locator('.editor-preview h1')).toHaveText('Heading')
  await expect(page.locator('.editor-preview strong')).toHaveText('bold')

  await text.focus()
  await pasteImage(page, 'textarea.editor-input')
  await expect(text).toHaveValue(/!\[pasted-.*\.png\]\(\/api\/media\/[0-9a-f]{32}\/pasted-/)
  const image = page.locator('.editor-preview img')
  await expect(image).toBeVisible()
  expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)

  await page.locator('.editor-preview input[type="checkbox"]').nth(1).click()
  await expect(text).toHaveValue(/- \[ \] first\n- \[x\] second/)
  await expect(page.locator('.doc-status')).toHaveText('Saved', { timeout: 5000 })

  await page.reload()
  await expect(page.getByLabel('Note title')).toHaveValue('Plans')
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue(/- \[x\] second/)
})

test('a note warns instead of overwriting a change made elsewhere', async ({ page }) => {
  await signUp(page)
  await newNote(page)
  await page.getByRole('textbox', { name: 'Note text' }).fill('from tab one')
  await expect(page.locator('.doc-status')).toHaveText('Saved')
  const other = await page.context().newPage()
  await other.goto(page.url())
  await other.getByRole('textbox', { name: 'Note text' }).fill('from tab two')
  await expect(other.locator('.doc-status')).toHaveText('Saved')
  await other.close()
  await page.getByRole('textbox', { name: 'Note text' }).fill('stale edit')
  await expect(page.getByRole('alert')).toContainText('changed somewhere else')
  await page.getByRole('button', { name: 'Load theirs' }).click()
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('from tab two')
})

test('a markdown file becomes a note and other files keep their preview', async ({ page }) => {
  await signUp(page)
  await page.goto('/files')
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload' }).click()
  await (await picker).setFiles([
    { name: 'readme.md', mimeType: 'text/markdown', buffer: Buffer.from('# From disk') },
    { name: 'photo.png', mimeType: 'image/png', buffer: PNG },
  ])
  await expect(page.getByRole('link', { name: 'photo.png' })).toBeVisible()
  await page.getByRole('link', { name: 'photo.png' }).click()
  await expect(page.locator('.file-image')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/notes')
  await page.getByRole('link', { name: 'readme' }).click()
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('# From disk')
})

test('boards: cards, drag between columns, details, column management', async ({ page }) => {
  await signUp(page)
  await page.getByRole('button', { name: 'New board' }).first().click()
  await expect(page.getByLabel('Board title')).toBeVisible()
  await page.getByLabel('Board title').fill('Launch')
  await page.getByLabel('Board title').press('Enter')

  const todo = page.getByRole('region', { name: 'To do' })
  await todo.getByRole('button', { name: 'Add card' }).click()
  await page.getByLabel('New card title').fill('Write copy')
  await page.getByLabel('New card title').press('Enter')
  await page.getByLabel('New card title').fill('Ship it')
  await page.getByLabel('New card title').press('Enter')
  await expect(todo.locator('.card')).toHaveCount(2)

  // Drag a card to the next column with a real pointer.
  const card = todo.getByRole('button', { name: 'Open Ship it' })
  const doing = page.getByRole('region', { name: 'Doing' })
  const from = (await card.boundingBox())!
  const to = (await doing.boundingBox())!
  await page.mouse.move(from.x + 30, from.y + 15)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 20, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 })
  await page.mouse.up()
  await expect(doing.locator('.card')).toHaveCount(1)

  // Details.
  await doing.getByRole('button', { name: 'Open Ship it' }).click()
  await page.getByLabel('Add label').fill('urgent')
  await page.getByLabel('Add label').press('Enter')
  await page.getByLabel('Due').fill('2031-03-04')
  await page.getByRole('textbox', { name: 'Card description' }).fill('- [x] one\n- [ ] two')
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(doing.locator('.task-count')).toHaveText('1/2')

  await page.reload()
  const reloaded = page.getByRole('region', { name: 'Doing' })
  await expect(reloaded.getByText('Ship it')).toBeVisible()
  await expect(reloaded.getByText('urgent')).toBeVisible()
  await expect(page.getByRole('region', { name: 'To do' }).getByText('Ship it')).toHaveCount(0)

  // Columns.
  await page.getByRole('button', { name: 'Add column' }).click()
  await page.getByLabel('New column name').fill('Later')
  await page.getByLabel('New column name').press('Enter')
  await expect(page.getByRole('region', { name: 'Later' })).toBeVisible()
  await page.getByRole('button', { name: 'Doing options' }).click()
  await page.getByRole('menuitem', { name: 'Delete, cards to Later' }).click()
  await expect(page.getByRole('region', { name: 'Doing' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Later' }).getByText('Ship it')).toBeVisible()
})

test('collections: create, nest, move with undo, rename, delete keeps contents', async ({ page }) => {
  await signUp(page)
  await page.getByRole('button', { name: 'New collection' }).first().click()
  await page.getByLabel('Name').fill('Work')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Work' })).toBeVisible()

  await newNote(page)
  await page.getByLabel('Note title').fill('Filed note')
  await expect(page.locator('.doc-status')).toHaveText('Saved')
  await page.goto('/all')
  await page.getByRole('button', { name: 'Filed note options' }).click({ force: true })
  await page.getByRole('menuitem', { name: 'Move to...' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Work' }).click()
  await expect(page.getByText('Moved')).toBeVisible()
  await page.getByRole('complementary').getByRole('link', { name: 'Work' }).click()
  await expect(page.getByRole('link', { name: 'Filed note' })).toBeVisible()

  await page.getByLabel('Collection name').fill('Work stuff')
  await page.getByLabel('Collection name').press('Enter')
  await expect(page.getByRole('complementary').getByRole('link', { name: 'Work stuff' })).toBeVisible()

  await page.getByRole('button', { name: 'Collection options' }).click()
  await page.getByRole('menuitem', { name: 'Delete collection' }).click()
  await page.getByRole('button', { name: 'Delete collection' }).click()
  await expect(page.getByRole('heading', { name: 'Everything' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Filed note' })).toBeVisible()
})

test('selecting many, then trash, undo, and the trash page', async ({ page }) => {
  await signUp(page)
  for (const title of ['One', 'Two']) {
    await page.goto('/')
    await newNote(page)
    await page.getByLabel('Note title').fill(title)
    await expect(page.locator('.doc-status')).toHaveText('Saved')
  }
  await page.goto('/notes')
  await page.getByRole('button', { name: 'Select items' }).click()
  await page.getByRole('link', { name: 'One' }).click()
  await page.getByRole('link', { name: 'Two' }).click()
  await page.getByRole('toolbar', { name: 'Selected items' }).getByRole('button', { name: 'Trash' }).click()
  await expect(page.getByText('2 items moved to trash')).toBeVisible()
  await expect(page.getByRole('link', { name: 'One' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('link', { name: 'One' })).toBeVisible()

  await page.getByRole('button', { name: 'One options' }).click({ force: true })
  await page.getByRole('menuitem', { name: 'Move to trash' }).click()
  await page.goto('/trash')
  await page.getByRole('button', { name: 'Restore One' }).click()
  await expect(page.getByText('The trash is empty.')).toBeVisible()
})

test('search finds notes and cards', async ({ page }) => {
  await signUp(page)
  await newNote(page)
  const word = unique('zebra')
  await page.getByRole('textbox', { name: 'Note text' }).fill(`has ${word} inside`)
  await expect(page.locator('.doc-status')).toHaveText('Saved')
  await page.getByRole('button', { name: /^Search/ }).click()
  await page.getByRole('dialog', { name: 'Search' }).getByLabel('Search').fill(word)
  await expect(page.locator('.palette-text')).toContainText(word)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue(`has ${word} inside`)
})

test('secrets: encrypted link reveals once, then is gone', async ({ page, browser }) => {
  await signUp(page)
  await page.goto('/secrets')
  await page.getByLabel('Secret', { exact: true }).fill('hunter2 🔑')
  await page.getByLabel('Label (only you see this)').fill('Wifi')
  const requests: string[] = []
  page.on('request', (r) => { if (r.url().includes('/api/secrets') && r.method() === 'POST') requests.push(r.postData() ?? '') })
  await page.getByRole('button', { name: 'Create secret link' }).click()
  const link = await page.getByLabel('Secret link').inputValue()
  expect(link).toMatch(/\/s\/[0-9a-f]{32}#.+/)
  expect(requests[0]).not.toContain('hunter2')
  expect(requests[0]).not.toContain(link.split('#')[1])
  await expect(page.getByRole('listitem').filter({ hasText: 'Wifi' })).toContainText('1 view left')

  const guest = await newContext(browser)
  await guest.goto(link)
  await guest.reload() // Opening the page twice costs nothing, and the key must survive it.
  await guest.getByRole('button', { name: 'Reveal secret' }).click()
  await expect(guest.locator('.secret-output')).toHaveText('hunter2 🔑')
  expect(guest.url()).not.toContain('#')
  await guest.goto('about:blank')
  await guest.goto(link)
  await expect(guest.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: 'Wifi' })).toContainText('Viewed')
})

test('secrets: a wrong passphrase costs nothing', async ({ page, browser }) => {
  await signUp(page)
  await page.goto('/secrets')
  await page.getByLabel('Secret', { exact: true }).fill('top secret')
  await page.getByLabel('Passphrase (optional, send it separately)').fill('open sesame')
  await page.getByRole('button', { name: 'Create secret link' }).click()
  const link = await page.getByLabel('Secret link').inputValue()
  const guest = await newContext(browser)
  await guest.goto(link)
  await guest.getByLabel('Passphrase').fill('wrong')
  await guest.getByRole('button', { name: 'Reveal secret' }).click()
  await expect(guest.getByRole('alert')).toContainText('not right')
  await guest.getByLabel('Passphrase').fill('open sesame')
  await guest.getByRole('button', { name: 'Reveal secret' }).click()
  await expect(guest.locator('.secret-output')).toHaveText('top secret')
})

test('share links: password-protected note with its image, opened by a guest', async ({ page, browser }) => {
  await signUp(page)
  await newNote(page)
  await page.getByLabel('Note title').fill('Shared plan')
  await page.getByRole('textbox', { name: 'Note text' }).focus()
  await page.getByRole('textbox', { name: 'Note text' }).fill('Hello **guest**\n\n')
  await pasteImage(page, 'textarea.editor-input')
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue(/api\/media/)
  await expect(page.locator('.doc-status')).toHaveText('Saved', { timeout: 5000 })
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByLabel('Password (optional)').fill('letmein')
  await page.getByRole('button', { name: 'Create link' }).click()
  const url = await page.locator('.share-url').innerText()

  const guest = await newContext(browser)
  await guest.goto(url.replace(/^https?:\/\/[^/]+/, ''))
  await guest.getByLabel('Password').fill('wrong')
  await guest.getByRole('button', { name: 'Open' }).click()
  await expect(guest.getByRole('alert')).toBeVisible()
  await guest.getByLabel('Password').fill('letmein')
  await guest.getByRole('button', { name: 'Open' }).click()
  await expect(guest.locator('.md strong')).toHaveText('guest')
  await expect.poll(() => guest.locator('.md img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)
  await page.getByRole('button', { name: 'Delete link' }).click()
  await guest.reload()
  await expect(guest.getByRole('heading', { name: 'Link not available' })).toBeVisible()
})

test('users cannot see each other', async ({ page, browser }) => {
  await signUp(page)
  await newNote(page)
  await page.getByLabel('Note title').fill('Private thing')
  await expect(page.locator('.doc-status')).toHaveText('Saved')
  const noteUrl = page.url()

  const other = await newContext(browser)
  await signUp(other)
  await other.goto('/all')
  await expect(other.getByText('Nothing here yet.')).toBeVisible()
  await other.goto(noteUrl)
  await expect(other.getByText('This note could not be opened.')).toBeVisible()
})

test('forum: post, comment, guests read, script in markdown does nothing', async ({ page, browser, problems }) => {
  await signUp(page)
  await page.goto('/forum')
  await page.getByRole('link', { name: 'New post' }).click()
  const title = unique('Hello forum')
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Category').fill('News')
  await page.getByRole('textbox', { name: 'Post text' }).fill('Body\n\n<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>\n\n[bad](javascript:window.pwned=1)')
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('textbox', { name: 'Your comment' }).fill('First **comment**')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.locator('.comment strong').last()).toHaveText('comment')
  const url = page.url()

  const guest = await newContext(browser)
  await guest.goto(url.replace(/^https?:\/\/[^/]+/, ''))
  await expect(guest.getByRole('heading', { name: title })).toBeVisible()
  await expect(guest.getByText('First')).toBeVisible()
  await expect(guest.getByRole('link', { name: 'Sign in to comment' })).toBeVisible()
  expect(await guest.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined()
  expect(await guest.locator('.md a[href^="javascript"]').count()).toBe(0)
  expect(await guest.locator('.md img[onerror]').count()).toBe(0)

  // Chrome logs this when DOMPurify parses the payload in an inert document, where nothing runs.
  // The checks above are what prove nothing ran.
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined()
  problems.splice(0, problems.length, ...problems.filter((p) => !p.includes('inline event handler')))

  await page.getByRole('button', { name: 'Post options' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('heading', { name: 'Forum' })).toBeVisible()
})

test('theme and accent stick, and follow the account to a new browser', async ({ page, browser }) => {
  const name = await signUp(page)
  await page.goto('/settings')
  await page.getByRole('radio', { name: 'Sage' }).click()
  await page.getByRole('radio', { name: 'Jade' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage')
  await page.waitForTimeout(1200) // Preferences save debounced.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage')

  const other = await newContext(browser)
  await other.goto('/')
  await other.getByLabel('Name').fill(name)
  await other.getByLabel('Password').fill('password-123')
  await other.getByRole('button', { name: 'Sign in' }).click()
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'sage')
})

test('phone layout works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await signUp(page)
  await page.getByRole('button', { name: 'Create new' }).last().click()
  await page.getByRole('menuitem', { name: 'New board' }).click()
  await expect(page.getByRole('region', { name: 'To do' })).toBeVisible()
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Secrets' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('during a users-api outage private data closes and public pages stay up', async ({ page, request }) => {
  await signUp(page)
  await request.post('http://127.0.0.1:8098/test/down/1')
  try {
    await expect.poll(async () => (await request.get('/api/items')).status(), { timeout: 8000 }).toBe(503)
    expect((await request.get('/api/forum/posts')).status()).toBe(200)
    expect((await (await request.get('/api/readyz')).json()).users_api).toBe('unavailable')
  } finally {
    await request.post('http://127.0.0.1:8098/test/down/0')
  }
  await expect.poll(async () => (await request.get('/api/session')).ok()).toBe(true)
})
