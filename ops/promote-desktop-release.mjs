import { promises as fs } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const releasesRoot = path.join(repoRoot, 'apps', 'desktop', 'releases')
const channelsRoot = path.join(releasesRoot, 'channels')

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const channel = args.channel || 'stable'
  const version = await resolveVersion(args.version)

  const release = await readJsonFile(path.join(releasesRoot, version, 'release.json'))
  const channelPath = path.join(channelsRoot, `${channel}.json`)
  const existing = (await fileExists(channelPath)) ? await readJsonFile(channelPath) : null

  const previous = Array.isArray(existing?.previous_versions)
    ? existing.previous_versions
    : []

  if (normalizeString(existing?.current_version) && existing.current_version !== version) {
    previous.unshift({
      version: existing.current_version,
      promoted_at: existing.updated_at || new Date().toISOString()
    })
  }

  const nextChannelState = {
    channel,
    current_version: version,
    updated_at: new Date().toISOString(),
    release,
    previous_versions: dedupePrevious(previous, version)
  }

  await writeJsonFile(channelPath, nextChannelState)
  process.stdout.write(`Promoted desktop release ${version} to ${channel}.\n`)
}

async function resolveVersion(explicitVersion) {
  const version = normalizeString(explicitVersion)

  if (version) {
    return version
  }

  const candidatePath = path.join(releasesRoot, 'latest-candidate.json')

  if (!(await fileExists(candidatePath))) {
    throw new Error('No --version was provided and latest-candidate.json is missing.')
  }

  const candidate = await readJsonFile(candidatePath)
  const candidateVersion = normalizeString(candidate.version)

  if (!candidateVersion) {
    throw new Error('latest-candidate.json does not include a version value.')
  }

  return candidateVersion
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
