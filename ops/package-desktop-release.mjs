import { promises as fs } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const desktopRoot = path.join(repoRoot, 'apps', 'desktop')
const releasesRoot = path.join(desktopRoot, 'releases')
const manifestPath = path.join(desktopRoot, 'release-manifest.json')
const signingReportPath = path.join(desktopRoot, 'release-signing-report.json')
const packageJsonPath = path.join(desktopRoot, 'package.json')

async function main() {
  const [manifest, desktopPackage] = await Promise.all([
    readJsonFile(manifestPath),
    readJsonFile(packageJsonPath)
  ])

  const version = normalizeString(desktopPackage.version)

  if (!version) {
    throw new Error('apps/desktop/package.json is missing a version value.')
  }

  const releaseDir = path.join(releasesRoot, version)
  const releaseArtifactsDir = path.join(releaseDir, 'artifacts')

  await fs.rm(releaseDir, { recursive: true, force: true })
  await fs.mkdir(releaseArtifactsDir, { recursive: true })

  const copiedArtifacts = []

  for (const artifact of manifest.artifacts ?? []) {
    const relativePath = normalizeString(artifact.relative_path)

    if (!relativePath) {
      continue
    }

    const sourcePath = path.join(repoRoot, relativePath)
    const destinationPath = path.join(releaseArtifactsDir, relativePath)

    await fs.mkdir(path.dirname(destinationPath), { recursive: true })
    await fs.copyFile(sourcePath, destinationPath)

    copiedArtifacts.push({
      relative_path: relativePath,
      release_path: normalizeToPosix(path.relative(releaseDir, destinationPath)),
      bytes: artifact.bytes,
      sha256: artifact.sha256
    })
  }

  const hasSigningReport = await fileExists(signingReportPath)

  if (hasSigningReport) {
    await fs.copyFile(signingReportPath, path.join(releaseDir, 'release-signing-report.json'))
  }

  await fs.copyFile(manifestPath, path.join(releaseDir, 'release-manifest.json'))

  const releaseDocument = {
    version,
    created_at: new Date().toISOString(),
    artifact_count: copiedArtifacts.length,
    artifacts: copiedArtifacts,
    source_manifest: 'release-manifest.json',
    signing_report: hasSigningReport ? 'release-signing-report.json' : null
  }

  await writeJsonFile(path.join(releaseDir, 'release.json'), releaseDocument)

  await writeJsonFile(path.join(releasesRoot, 'latest-candidate.json'), {
    version,
    created_at: releaseDocument.created_at,
    release_path: normalizeToPosix(path.relative(releasesRoot, path.join(releaseDir, 'release.json')))
  })

  process.stdout.write(
    `Packaged desktop release ${version} with ${copiedArtifacts.length} artifacts at ${releaseDir}\n`
  )
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function normalizeToPosix(input) {
  return input.split(path.sep).join('/')
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
