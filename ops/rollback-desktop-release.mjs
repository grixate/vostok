import { promises as fs } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const releasesRoot = path.join(repoRoot, 'apps', 'desktop', 'releases')
const channelsRoot = path.join(releasesRoot, 'channels')

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const channel = args.channel || 'stable'
  const explicitVersion = normalizeString(args.version)
  const channelPath = path.join(channelsRoot, `${channel}.json`)

  if (!(await fileExists(channelPath))) {
    throw new Error(`Channel file does not exist: ${channelPath}`)
  }

  const currentState = await readJsonFile(channelPath)
  const history = Array.isArray(currentState.previous_versions) ? currentState.previous_versions : []
  const targetVersion = explicitVersion || normalizeString(history[0]?.version)

  if (!targetVersion) {
    throw new Error('No rollback target is available. Provide --version or promote a previous release first.')
  }

  const targetReleasePath = path.join(releasesRoot, targetVersion, 'release.json')

  if (!(await fileExists(targetReleasePath))) {
    throw new Error(`Rollback target release does not exist: ${targetReleasePath}`)
  }

  const targetRelease = await readJsonFile(targetReleasePath)
  const nextPrevious = history.filter((entry) => normalizeString(entry?.version) !== targetVersion)

  if (normalizeString(currentState.current_version) && currentState.current_version !== targetVersion) {
    nextPrevious.unshift({
      version: currentState.current_version,
      promoted_at: currentState.updated_at || new Date().toISOString()
    })
  }

  const nextState = {
    channel,
    current_version: targetVersion,
    updated_at: new Date().toISOString(),
    release: targetRelease,
    previous_versions: dedupePrevious(nextPrevious, targetVersion)
  }

  await writeJsonFile(channelPath, nextState)
  process.stdout.write(`Rolled back ${channel} channel to ${targetVersion}.\n`)
}

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (!token.startsWith('--')) {
      continue
    }

    const key = token.slice(2)
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : 'true'

    args[key] = value

    if (value !== 'true') {
      index += 1
    }
  }

  return args
}

function dedupePrevious(previousVersions, currentVersion) {
  const seen = new Set([currentVersion])
  const filtered = []

  for (const entry of previousVersions) {
    const version = normalizeString(entry?.version)

    if (!version || seen.has(version)) {
      continue
    }

    seen.add(version)
    filtered.push({
      version,
      promoted_at: normalizeString(entry?.promoted_at) || new Date().toISOString()
    })
  }

  return filtered.slice(0, 20)
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
