#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '..')
const sourcePath = resolve(rootDirectory, 'assets/brand/logo-source.png')

const outputs = [
  { path: resolve(rootDirectory, 'public/logo.png'), size: 768, padding: 54 },
  { path: resolve(rootDirectory, 'public/favicon.png'), size: 256, padding: 16 },
  { path: resolve(rootDirectory, 'public/apple-touch-icon.png'), size: 180, padding: 12 },
]

const source = await readFile(sourcePath)
const sourceDataUrl = `data:image/png;base64,${source.toString('base64')}`

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const result = await page.evaluate(
    async ({ dataUrl, targets }) => {
      const image = new Image()
      image.src = dataUrl
      await image.decode()

      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = image.naturalWidth
      sourceCanvas.height = image.naturalHeight
      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
      if (!sourceContext) throw new Error('Could not create source canvas context')
      sourceContext.drawImage(image, 0, 0)

      const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data
      const width = sourceCanvas.width
      const height = sourceCanvas.height
      const visited = new Uint8Array(width * height)
      const queue = new Int32Array(width * height)
      const alphaThreshold = 8
      let largest = null

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const start = y * width + x
          if (visited[start] || pixels[start * 4 + 3] < alphaThreshold) continue

          let head = 0
          let tail = 0
          let area = 0
          let minX = x
          let maxX = x
          let minY = y
          let maxY = y
          visited[start] = 1
          queue[tail++] = start

          while (head < tail) {
            const index = queue[head++]
            const pixelX = index % width
            const pixelY = Math.floor(index / width)
            area++
            minX = Math.min(minX, pixelX)
            maxX = Math.max(maxX, pixelX)
            minY = Math.min(minY, pixelY)
            maxY = Math.max(maxY, pixelY)

            for (let offsetY = -1; offsetY <= 1; offsetY++) {
              for (let offsetX = -1; offsetX <= 1; offsetX++) {
                if (offsetX === 0 && offsetY === 0) continue
                const nextX = pixelX + offsetX
                const nextY = pixelY + offsetY
                if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue

                const next = nextY * width + nextX
                if (visited[next] || pixels[next * 4 + 3] < alphaThreshold) continue
                visited[next] = 1
                queue[tail++] = next
              }
            }
          }

          if (!largest || area > largest.area) {
            largest = { area, minX, maxX, minY, maxY }
          }
        }
      }

      if (!largest) throw new Error('Logo source has no visible pixels')

      const edgePadding = Math.max(4, Math.round(Math.max(width, height) * 0.01))
      const crop = {
        x: Math.max(0, largest.minX - edgePadding),
        y: Math.max(0, largest.minY - edgePadding),
        width: Math.min(width - Math.max(0, largest.minX - edgePadding), largest.maxX - largest.minX + 1 + edgePadding * 2),
        height: Math.min(height - Math.max(0, largest.minY - edgePadding), largest.maxY - largest.minY + 1 + edgePadding * 2),
      }

      const images = targets.map(({ size, padding }) => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Could not create output canvas context')

        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        const available = size - padding * 2
        const scale = Math.min(available / crop.width, available / crop.height)
        const drawWidth = crop.width * scale
        const drawHeight = crop.height * scale
        const drawX = (size - drawWidth) / 2
        const drawY = (size - drawHeight) / 2

        context.drawImage(
          sourceCanvas,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          drawX,
          drawY,
          drawWidth,
          drawHeight,
        )

        return canvas.toDataURL('image/png').split(',')[1]
      })

      return {
        source: { width, height },
        component: largest,
        crop,
        images,
      }
    },
    {
      dataUrl: sourceDataUrl,
      targets: outputs.map(({ size, padding }) => ({ size, padding })),
    },
  )

  await Promise.all(
    outputs.map(({ path }, index) => writeFile(path, Buffer.from(result.images[index], 'base64'))),
  )

  console.log(
    `Logo component ${result.component.minX},${result.component.minY} to ${result.component.maxX},${result.component.maxY}; crop ${result.crop.width}x${result.crop.height}+${result.crop.x}+${result.crop.y}`,
  )
  for (const output of outputs) {
    console.log(`Generated ${output.path} (${output.size}x${output.size})`)
  }
} finally {
  await browser.close()
}
