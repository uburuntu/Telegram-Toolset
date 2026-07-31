import { expect, test } from '@playwright/test'

// Runs against `vite preview` serving the real production build. The goal is to
// catch prod-only failures the dev server hides: a broken base path, minifier
// output that breaks Vue templates, or lazy chunks that fail to load.
test.describe('Production build smoke', () => {
  test('boots and opens a lazy route without asset failures', async ({ page }) => {
    const pageErrors: string[] = []
    const failedAssets: string[] = []

    const isCoreAsset = (resourceType: string) =>
      resourceType === 'script' || resourceType === 'stylesheet' || resourceType === 'document'

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })
    page.on('requestfailed', (request) => {
      if (isCoreAsset(request.resourceType())) {
        failedAssets.push(`${request.url()} (${request.failure()?.errorText ?? 'failed'})`)
      }
    })
    page.on('response', (response) => {
      if (isCoreAsset(response.request().resourceType()) && response.status() >= 400) {
        failedAssets.push(`${response.status()} ${response.url()}`)
      }
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Telegram Power Toolset' })).toBeVisible()
    await expect(page.getByText('Export Deleted Messages')).toBeVisible()
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://telegram-toolset.rmbk.me/social-preview.png',
    )
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png')

    const imageDimensions = (source: string) =>
      page.evaluate(async (url) => {
        const image = new Image()
        image.src = url
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, source)

    const favicon = await page.request.get('/favicon.png')
    expect(favicon.ok()).toBe(true)
    expect(favicon.headers()['content-type']).toContain('image/png')
    expect(await imageDimensions('/favicon.png')).toEqual({ width: 256, height: 256 })

    const logo = await page.request.get('/logo.png')
    expect(logo.ok()).toBe(true)
    expect(logo.headers()['content-type']).toContain('image/png')
    expect(await imageDimensions('/logo.png')).toEqual({ width: 512, height: 512 })

    const socialPreview = await page.request.get('/social-preview.png')
    expect(socialPreview.ok()).toBe(true)
    expect(socialPreview.headers()['content-type']).toContain('image/png')
    expect((await socialPreview.body()).byteLength).toBeGreaterThan(10_000)

    expect(await imageDimensions('/social-preview.png')).toEqual({ width: 1280, height: 640 })

    // Opening a module pulls in the lazy auth flow in the production bundle.
    await page.getByText('Account Info').click()
    await expect(page.getByText('Add Account')).toBeVisible()
    await expect(page.getByTestId('tab-user')).toBeVisible()
    await expect(page.getByTestId('tab-bot')).toBeVisible()

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([])
    expect(failedAssets, `failed asset requests:\n${failedAssets.join('\n')}`).toEqual([])
  })
})
