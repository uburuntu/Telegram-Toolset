#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '..')
const faviconPath = resolve(rootDirectory, 'public/favicon.svg')
const outputPath = resolve(rootDirectory, 'public/social-preview.png')

const favicon = await readFile(faviconPath, 'utf8')
const faviconDataUrl = `data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}`

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
      .canvas {
        position: relative;
        width: 1280px;
        height: 640px;
        padding: 58px 64px;
        border-top: 12px solid #2563eb;
      }
      .left {
        position: relative;
        z-index: 1;
        width: 610px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 34px;
      }
      .brand img { width: 58px; height: 58px; }
      .brand-name {
        font-size: 20px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0;
      }
      .brand-meta {
        margin-top: 7px;
        color: #64748b;
        font-size: 14px;
      }
      h1 {
        margin: 0;
        max-width: 590px;
        font-size: 66px;
        line-height: 1.02;
        letter-spacing: 0;
      }
      .subtitle {
        width: 560px;
        margin: 24px 0 30px;
        color: #475569;
        font-size: 24px;
        line-height: 1.4;
      }
      .proof {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px 30px;
        width: 540px;
      }
      .proof-item {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #334155;
        font-size: 16px;
        font-weight: 600;
      }
      .check {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 2px solid #16a34a;
        border-radius: 50%;
        color: #15803d;
        font-size: 13px;
        font-weight: 800;
      }
      .workspace {
        position: absolute;
        z-index: 2;
        top: 54px;
        right: 56px;
        width: 508px;
        height: 532px;
        overflow: hidden;
        border: 1px solid #d7dee8;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 16px 42px rgba(15, 23, 42, 0.12);
      }
      .workspace-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 60px;
        padding: 0 22px;
        border-bottom: 1px solid #e5e7eb;
      }
      .workspace-title { font-size: 16px; font-weight: 700; }
      .account {
        display: flex;
        align-items: center;
        gap: 9px;
        color: #475569;
        font-size: 13px;
        font-weight: 600;
      }
      .avatar {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: #2563eb;
        color: white;
        font-size: 11px;
      }
      .tool {
        margin: 18px 20px 0;
        padding: 17px 18px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        background: #fff;
      }
      .tool-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 13px;
      }
      .tool-name {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 15px;
        font-weight: 700;
      }
      .tool-icon {
        width: 9px;
        height: 28px;
        border-radius: 3px;
      }
      .blue { background: #2563eb; }
      .red { background: #dc2626; }
      .green { background: #16a34a; }
      .status {
        color: #64748b;
        font-size: 12px;
        font-weight: 600;
      }
      .chat-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 14px;
        padding: 9px 0;
        border-top: 1px solid #f1f5f9;
        font-size: 13px;
      }
      .chat-row:first-of-type { border-top: 0; }
      .chat-name { color: #334155; font-weight: 600; }
      .count { color: #64748b; }
      .facts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 14px;
      }
      .fact {
        padding: 9px 10px;
        border-left: 3px solid #16a34a;
        background: #f8fafc;
        color: #334155;
        font-size: 12px;
        line-height: 1.25;
      }
      .fact strong { display: block; margin-top: 2px; color: #111827; font-size: 13px; }
      .formats { display: flex; gap: 8px; }
      .format {
        padding: 7px 10px;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        color: #475569;
        font-size: 12px;
        font-weight: 700;
      }
      .footer {
        position: absolute;
        z-index: 1;
        left: 64px;
        bottom: 35px;
        color: #64748b;
        font-size: 14px;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <div class="canvas">
      <section class="left">
        <div class="brand">
          <img src="${faviconDataUrl}" alt="" />
          <div>
            <div class="brand-name">Telegram Toolset</div>
            <div class="brand-meta">Open source &middot; local first</div>
          </div>
        </div>
        <h1>Telegram<br />Toolset</h1>
        <p class="subtitle">Private, browser-based power tools. Your Telegram data stays yours.</p>
        <div class="proof">
          <div class="proof-item"><span class="check">&check;</span> No backend</div>
          <div class="proof-item"><span class="check">&check;</span> Reviewed mutations</div>
          <div class="proof-item"><span class="check">&check;</span> Encrypted sessions</div>
          <div class="proof-item"><span class="check">&check;</span> Cross-browser tested</div>
        </div>
      </section>

      <section class="workspace" aria-label="Telegram Toolset workspace preview">
        <div class="workspace-bar">
          <div class="workspace-title">Workspace</div>
          <div class="account"><span class="avatar">AE</span> Alice</div>
        </div>

        <div class="tool">
          <div class="tool-head">
            <div class="tool-name"><span class="tool-icon red"></span>Delete my messages</div>
            <div class="status">Review first</div>
          </div>
          <div class="chat-row"><span class="chat-name">Public Archive</span><span class="count">128 messages</span></div>
          <div class="chat-row"><span class="chat-name">Project Group</span><span class="count">24 messages</span></div>
        </div>

        <div class="tool">
          <div class="tool-head">
            <div class="tool-name"><span class="tool-icon green"></span>Account security</div>
            <div class="status">On device</div>
          </div>
          <div class="facts">
            <div class="fact">Two-step verification<strong>Enabled</strong></div>
            <div class="fact">Authorized sessions<strong>3 total</strong></div>
          </div>
        </div>

        <div class="tool">
          <div class="tool-head">
            <div class="tool-name"><span class="tool-icon blue"></span>LLM context export</div>
            <div class="status">No in-app AI</div>
          </div>
          <div class="formats"><span class="format">Markdown</span><span class="format">JSON</span><span class="format">Plain text</span></div>
        </div>
      </section>

      <div class="footer">EXPORT &middot; RESEND &middot; SCHEDULE &middot; REVIEW &middot; DELETE</div>
    </div>
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
