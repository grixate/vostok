import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const bundleRoot = path.join(
  repoRoot,
  'apps',
  'desktop',
  'src-tauri',
  'target',
  'release',
  'bundle'
)
const outputPath = path.join(repoRoot, 'apps', 'desktop', 'release-manifest.json')

async function main() {
  const artifacts = await collectArtifacts(bundleRoot)
  const manifest = {
    generated_at: new Date().toISOString(),
    bundle_root: bundleRoot,
    artifact_count: artifacts.length,
    artifacts
  }

  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  process.stdout.write(`Wrote desktop release manifest to ${outputPath}\n`)
}

async function collectArtifacts(rootPath) {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true })
    const artifacts = []

    for (const entry of entries) {
      const absolutePath = path.join(rootPath, entry.name)

      if (entry.isDirectory()) {
        artifacts.push(...(await collectArtifacts(absolutePath)))
        continue
      }

      const stat = await fs.stat(absolutePath)
      artifacts.push({
        relative_path: path.relative(repoRoot, absolutePath),
        bytes: stat.size,
        sha256: await sha256File(absolutePath)
      })
    }

    return artifacts.sort((left, right) => left.relative_path.localeCompare(right.relative_path))
  } catch (error) {
    if (isMissingPath(error)) {
      return []
    }

    throw error
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  const file = await fs.readFile(filePath)
  hash.update(file)
  return hash.digest('hex')
}

function isMissingPath(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
