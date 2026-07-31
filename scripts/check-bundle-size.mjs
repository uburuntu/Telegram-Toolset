#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(scriptDir, '..')
const distDir = resolve(rootDir, 'dist')
const assetsDir = resolve(distDir, 'assets')
const reportPath = resolve(rootDir, 'bundle-size-report.json')

const budgets = {
  largestJsAsset: {
    rawBytes: 1_350_000,
    gzipBytes: 400_000,
  },
  totalJs: {
    // mtcute's generated TL schema compresses heavily; keep the network-facing gzip cap unchanged.
    rawBytes: 1_775_000,
    gzipBytes: 525_000,
  },
  totalCss: {
    rawBytes: 50_000,
    gzipBytes: 10_000,
  },
  // Ceiling every code-split locale chunk must stay under. Only the largest locale counts toward the
  // JS download budget (a user fetches one locale), so this per-locale cap is what actually guards
  // against ANY locale ballooning — not just the current largest — closing the code-split blind spot.
  perLocaleChunk: {
    rawBytes: 65_000,
    gzipBytes: 16_000,
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

// Non-default locale catalogs are code-split and loaded on demand. Any given
// user downloads at most one of them, so summing all locales into the JS budget
// would penalize legitimate code-splitting: each chunk repeats the shared
// translation keys and loses the cross-locale gzip dedup that a single combined
// chunk enjoyed. Count only the single largest locale chunk toward the budget —
// a realistic worst case (app + one locale) — while still guarding against any
// individual locale ballooning.
const LAZY_LOCALES = ['ru', 'es', 'id', 'pt', 'fa', 'ar', 'uz', 'tr', 'uk']
// Vite names a locale chunk after its source basename: `./locales/ru.json` -> `ru-<hash>.js`. The
// pattern stays permissive on the hash so it never fails to match a real locale chunk (a false
// negative would inflate the budgeted total and fail CI spuriously). The trade-off is that a future
// non-locale chunk whose basename starts with a locale code + `-` could match; the count check below
// surfaces that drift instead of letting it silently skew the budget.
const localeChunkPattern = new RegExp(`(^|/)(${LAZY_LOCALES.join('|')})-[A-Za-z0-9_-]+\\.js$`)

const localeAssets = jsSummary.assets.filter((asset) => localeChunkPattern.test(asset.file))
const nonLocaleAssets = jsSummary.assets.filter((asset) => !localeChunkPattern.test(asset.file))

if (localeAssets.length !== LAZY_LOCALES.length) {
  console.warn(
    `Bundle check: matched ${localeAssets.length} locale chunk(s), expected ${LAZY_LOCALES.length}. ` +
      'The locale set or the chunk-naming assumption may have drifted; verify the budget still reflects one-locale-per-user.',
  )
}

const nonLocaleRawBytes = nonLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0)
const nonLocaleGzipBytes = nonLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0)
const largestLocaleRawBytes = localeAssets.reduce((max, asset) => Math.max(max, asset.rawBytes), 0)
const largestLocaleGzipBytes = localeAssets.reduce(
  (max, asset) => Math.max(max, asset.gzipBytes),
  0,
)

// Budgeted footprint = all non-locale JS + the single largest locale chunk.
const budgetedJsRawBytes = nonLocaleRawBytes + largestLocaleRawBytes
const budgetedJsGzipBytes = nonLocaleGzipBytes + largestLocaleGzipBytes

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
    label: 'Budgeted JS (raw, app + largest locale)',
    actual: budgetedJsRawBytes,
    limit: budgets.totalJs.rawBytes,
  },
  {
    label: 'Budgeted JS (gzip, app + largest locale)',
    actual: budgetedJsGzipBytes,
    limit: budgets.totalJs.gzipBytes,
  },
  {
    label: 'Largest locale chunk (raw)',
    actual: largestLocaleRawBytes,
    limit: budgets.perLocaleChunk.rawBytes,
  },
  {
    label: 'Largest locale chunk (gzip)',
    actual: largestLocaleGzipBytes,
    limit: budgets.perLocaleChunk.gzipBytes,
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
  budgetedJs: {
    rawBytes: budgetedJsRawBytes,
    gzipBytes: budgetedJsGzipBytes,
    largestLocaleRawBytes,
    largestLocaleGzipBytes,
    localeChunkCount: localeAssets.length,
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
console.log(`Total JS:  ${formatKilobytes(jsSummary.totalRawBytes)} raw / ${formatKilobytes(jsSummary.totalGzipBytes)} gzip (all locales)`)
console.log(
  `Budgeted JS: ${formatKilobytes(budgetedJsRawBytes)} raw / ${formatKilobytes(budgetedJsGzipBytes)} gzip (app + largest of ${localeAssets.length} locale chunks)`,
)
console.log(
  `Largest locale chunk: ${formatKilobytes(largestLocaleRawBytes)} raw / ${formatKilobytes(largestLocaleGzipBytes)} gzip (ceiling ${formatKilobytes(budgets.perLocaleChunk.rawBytes)} raw · ${formatKilobytes(budgets.perLocaleChunk.gzipBytes)} gzip)`,
)
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
    `- Total JS: ${formatKilobytes(jsSummary.totalRawBytes)} raw / ${formatKilobytes(jsSummary.totalGzipBytes)} gzip (all locales)`,
    `- Budgeted JS: ${formatKilobytes(budgetedJsRawBytes)} raw / ${formatKilobytes(budgetedJsGzipBytes)} gzip (app + largest locale) / budget ${formatKilobytes(budgets.totalJs.rawBytes)} raw · ${formatKilobytes(budgets.totalJs.gzipBytes)} gzip`,
    `- Largest locale chunk: ${formatKilobytes(largestLocaleRawBytes)} raw / ${formatKilobytes(largestLocaleGzipBytes)} gzip / ceiling ${formatKilobytes(budgets.perLocaleChunk.rawBytes)} raw · ${formatKilobytes(budgets.perLocaleChunk.gzipBytes)} gzip`,
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
