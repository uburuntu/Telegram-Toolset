#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '..')
const logoPath = resolve(rootDirectory, 'public/logo.png')
const outputPath = resolve(rootDirectory, 'public/social-preview.png')

const logo = await readFile(logoPath)
const logoDataUrl = `data:image/png;base64,${logo.toString('base64')}`

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { width: 1280px; height: 640px; margin: 0; overflow: hidden; }
      body {
        font-family: Arial, Helvetica, sans-serif;
        color: #111827;
        background: #f8fafc;
      }
      main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 340px;
        align-items: center;
        width: 1280px;
        height: 640px;
        padding: 68px 82px;
        border-top: 12px solid #2563eb;
      }
      .eyebrow {
        margin: 0 0 22px;
        color: #2563eb;
        font-size: 18px;
        font-weight: 700;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 78px;
        line-height: 1;
      }
      .promise {
        max-width: 710px;
        margin: 28px 0 34px;
        color: #475569;
        font-size: 30px;
        line-height: 1.28;
      }
      .points {
        display: flex;
        align-items: center;
        gap: 0;
        color: #334155;
        font-size: 17px;
        font-weight: 700;
      }
      .points span + span::before {
        content: "";
        display: inline-block;
        width: 1px;
        height: 20px;
        margin: 0 20px;
        vertical-align: middle;
        background: #cbd5e1;
      }
      .mark {
        display: grid;
        place-items: center;
        justify-self: end;
        width: 292px;
        height: 292px;
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #fff;
      }
      .mark img { width: 190px; height: 190px; }
      .url {
        position: absolute;
        right: 82px;
        bottom: 40px;
        color: #64748b;
        font-size: 16px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <p class="eyebrow">Open source Telegram workspace</p>
        <h1>Telegram Toolset</h1>
        <p class="promise">Useful Telegram tools, all in one place.</p>
        <div class="points">
          <span>One login</span>
          <span>Growing toolbox</span>
          <span>Runs in your browser</span>
        </div>
      </section>
      <div class="mark"><img src="${logoDataUrl}" alt="" /></div>
      <div class="url">telegram-toolset.rmbk.me</div>
    </main>
  </body>
</html>`

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  const image = await page.screenshot({ type: 'png' })
  await writeFile(outputPath, image)
  console.log(`Generated ${outputPath}`)
} finally {
  await browser.close()
}
