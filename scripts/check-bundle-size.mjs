#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(scriptDir, '..')
const distDir = resolve(rootDir, 'dist')
const assetsDir = resolve(distDir, 'assets')
const reportPath = resolve(distDir, 'bundle-size-report.json')

const budgets = {
  largestJsAsset: {
    rawBytes: 1_350_000,
    gzipBytes: 400_000,
  },
  totalJs: {
    rawBytes: 1_750_000,
    gzipBytes: 525_000,
  },
  totalCss: {
    rawBytes: 50_000,
    gzipBytes: 10_000,
  },
}

function formatKilobytes(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`
}

function collectFiles(directory) {
  const files = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath))
      continue
    }

    files.push(fullPath)
  }

  return files
}

function summarizeAssets(extension) {
  const assets = collectFiles(assetsDir)
    .filter((filePath) => filePath.endsWith(extension))
    .map((filePath) => {
      const rawBytes = statSync(filePath).size
      const gzipBytes = gzipSync(readFileSync(filePath)).length

      return {
        file: relative(rootDir, filePath),
        rawBytes,
        gzipBytes,
      }
    })
    .sort((left, right) => right.rawBytes - left.rawBytes)

  const totalRawBytes = assets.reduce((sum, asset) => sum + asset.rawBytes, 0)
  const totalGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0)

  return {
    assets,
    totalRawBytes,
    totalGzipBytes,
  }
}

function buildTableRows(assets) {
  return assets
    .slice(0, 10)
    .map(
      (asset) =>
        `| \`${asset.file}\` | ${formatKilobytes(asset.rawBytes)} | ${formatKilobytes(asset.gzipBytes)} |`,
    )
    .join('\n')
}

if (!existsSync(assetsDir)) {
  console.error(`Bundle assets directory not found: ${assetsDir}`)
  process.exit(1)
}

const jsSummary = summarizeAssets('.js')
const cssSummary = summarizeAssets('.css')
const largestJsAsset = jsSummary.assets[0]

if (!largestJsAsset) {
  console.error('No JavaScript assets were found in dist/assets.')
  process.exit(1)
}

const checks = [
  {
    label: 'Largest JS asset (raw)',
    actual: largestJsAsset.rawBytes,
    limit: budgets.largestJsAsset.rawBytes,
  },
  {
    label: 'Largest JS asset (gzip)',
    actual: largestJsAsset.gzipBytes,
    limit: budgets.largestJsAsset.gzipBytes,
  },
  {
    label: 'Total JS (raw)',
    actual: jsSummary.totalRawBytes,
    limit: budgets.totalJs.rawBytes,
  },
  {
    label: 'Total JS (gzip)',
    actual: jsSummary.totalGzipBytes,
    limit: budgets.totalJs.gzipBytes,
  },
  {
    label: 'Total CSS (raw)',
    actual: cssSummary.totalRawBytes,
    limit: budgets.totalCss.rawBytes,
  },
  {
    label: 'Total CSS (gzip)',
    actual: cssSummary.totalGzipBytes,
    limit: budgets.totalCss.gzipBytes,
  },
]

const failures = checks.filter((check) => check.actual > check.limit)
const report = {
  budgets,
  largestJsAsset,
  totals: {
    js: {
      rawBytes: jsSummary.totalRawBytes,
      gzipBytes: jsSummary.totalGzipBytes,
    },
    css: {
      rawBytes: cssSummary.totalRawBytes,
      gzipBytes: cssSummary.totalGzipBytes,
    },
  },
  assets: {
    js: jsSummary.assets,
    css: cssSummary.assets,
  },
}

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)

console.log('Bundle size summary')
console.log(`Largest JS asset: ${largestJsAsset.file}`)
console.log(`  Raw:  ${formatKilobytes(largestJsAsset.rawBytes)}`)
console.log(`  Gzip: ${formatKilobytes(largestJsAsset.gzipBytes)}`)
console.log(`Total JS:  ${formatKilobytes(jsSummary.totalRawBytes)} raw / ${formatKilobytes(jsSummary.totalGzipBytes)} gzip`)
console.log(`Total CSS: ${formatKilobytes(cssSummary.totalRawBytes)} raw / ${formatKilobytes(cssSummary.totalGzipBytes)} gzip`)
console.log('\nTop bundle assets')
console.log('| Asset | Raw | Gzip |')
console.log('| --- | ---: | ---: |')
console.log(buildTableRows([...jsSummary.assets, ...cssSummary.assets].sort((left, right) => right.rawBytes - left.rawBytes)))

if (process.env.GITHUB_STEP_SUMMARY) {
  const summaryLines = [
    '## Bundle size',
    '',
    `Largest JS asset: \`${largestJsAsset.file}\``,
    '',
    `- Raw: ${formatKilobytes(largestJsAsset.rawBytes)} / budget ${formatKilobytes(budgets.largestJsAsset.rawBytes)}`,
    `- Gzip: ${formatKilobytes(largestJsAsset.gzipBytes)} / budget ${formatKilobytes(budgets.largestJsAsset.gzipBytes)}`,
    `- Total JS: ${formatKilobytes(jsSummary.totalRawBytes)} raw / ${formatKilobytes(jsSummary.totalGzipBytes)} gzip`,
    `- Total CSS: ${formatKilobytes(cssSummary.totalRawBytes)} raw / ${formatKilobytes(cssSummary.totalGzipBytes)} gzip`,
    '',
    '| Asset | Raw | Gzip |',
    '| --- | ---: | ---: |',
    buildTableRows([...jsSummary.assets, ...cssSummary.assets].sort((left, right) => right.rawBytes - left.rawBytes)),
    '',
  ]

  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join('\n'), { flag: 'a' })
}

if (failures.length > 0) {
  console.error('\nBundle budgets exceeded:')

  for (const failure of failures) {
    console.error(
      `- ${failure.label}: ${formatKilobytes(failure.actual)} exceeds ${formatKilobytes(failure.limit)}`,
    )
  }

  process.exit(1)
}

console.log('\nBundle budgets passed.')
