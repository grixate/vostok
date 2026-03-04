import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const desktopRoot = path.join(repoRoot, 'apps', 'desktop')
const bundleRoot = path.join(desktopRoot, 'src-tauri', 'target', 'release', 'bundle')
const reportPath = path.join(desktopRoot, 'release-signing-report.json')

const codesignIdentity = normalizeString(process.env.APPLE_CODESIGN_IDENTITY)
const notaryProfile = normalizeString(process.env.APPLE_NOTARY_PROFILE)

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Desktop bundle signing currently supports macOS hosts only.')
  }

  if (!codesignIdentity) {
    throw new Error('APPLE_CODESIGN_IDENTITY is required to sign desktop bundles.')
  }

  const targets = await collectSignTargets(bundleRoot)

  if (targets.length === 0) {
    throw new Error(`No signable artifacts found under ${bundleRoot}. Run the desktop build first.`)
  }

  const signedTargets = []
  const notarizedTargets = []

  for (const targetPath of targets) {
    const isAppBundle = targetPath.endsWith('.app')
    const signArgs = isAppBundle
      ? ['--force', '--deep', '--options', 'runtime', '--timestamp', '--sign', codesignIdentity, targetPath]
      : ['--force', '--options', 'runtime', '--timestamp', '--sign', codesignIdentity, targetPath]

    runCommand('codesign', signArgs)
    runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=2', targetPath])

    signedTargets.push({
      path: normalizeToPosix(path.relative(repoRoot, targetPath)),
      type: targetType(targetPath)
    })

    if (notaryProfile && shouldNotarize(targetPath)) {
      runCommand('xcrun', ['notarytool', 'submit', targetPath, '--keychain-profile', notaryProfile, '--wait'])
      runCommand('xcrun', ['stapler', 'staple', targetPath])

      notarizedTargets.push({
        path: normalizeToPosix(path.relative(repoRoot, targetPath)),
        type: targetType(targetPath)
      })
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    signing_identity: codesignIdentity,
    notarization_profile: notaryProfile,
    target_count: signedTargets.length,
    signed_targets: signedTargets,
    notarized_targets: notarizedTargets
  }

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`Signed ${signedTargets.length} desktop artifact(s). Report: ${reportPath}\n`)
}

async function collectSignTargets(rootPath) {
  const results = []

  if (!(await fileExists(rootPath))) {
    return results
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name)

    if (entry.isDirectory()) {
      if (entry.name.endsWith('.app')) {
        results.push(absolutePath)
        continue
      }

      results.push(...(await collectSignTargets(absolutePath)))
      continue
    }

    if (isSignableFile(entry.name)) {
      results.push(absolutePath)
    }
  }

  return dedupePaths(results)
}

function isSignableFile(fileName) {
  return (
    fileName.endsWith('.dmg') ||
    fileName.endsWith('.pkg') ||
    fileName.endsWith('.exe') ||
    fileName.endsWith('.msi') ||
    fileName.endsWith('.AppImage')
  )
}

function shouldNotarize(targetPath) {
  return targetPath.endsWith('.app') || targetPath.endsWith('.dmg') || targetPath.endsWith('.pkg')
}

function targetType(targetPath) {
  if (targetPath.endsWith('.app')) {
    return 'app_bundle'
  }

  return path.extname(targetPath).replace('.', '') || 'artifact'
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8'
  })

  if (result.status !== 0) {
    const stderr = normalizeString(result.stderr) || 'No stderr output.'
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr}`)
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function dedupePaths(paths) {
  return Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right))
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
