#!/usr/bin/env node
// extension/ 폴더(원본 그대로)를 크롬 설치용 zip으로 묶어 frontend/public/downloads/ 에 둡니다.
// 외부 패키지 없이 Node 기본 모듈만 쓰므로 Windows/macOS/Linux 어디서든 동작합니다.
// 사용: node scripts/build-extension-zip.mjs   (또는 frontend 에서 npm run build:extension)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const extDir = join(root, 'extension')
const outDir = join(root, 'frontend', 'public', 'downloads')
const zipName = 'jobseeker-apply.zip'

// 설치에 필요 없는 개발용 파일·폴더
const EXCLUDE = [/^demo/, /^tests$/, /^VERIFICATION\.md$/, /^package(-lock)?\.json$/, /^node_modules$/, /^\./]

const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'))
const version = manifest.version
// zip 안에 폴더를 두지 않습니다. 윈도우·맥의 '압축 풀기'가 zip 이름(jobseeker-apply)으로 폴더를 만들고
// manifest.json 이 바로 그 안에 들어가므로 폴더가 두 겹이 되지 않습니다.
const folder = zipName.replace(/\.zip$/, '')

function collect(dir) {
  const files = []
  for (const name of readdirSync(dir).sort()) {
    if (dir === extDir && EXCLUDE.some(re => re.test(name))) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files.push(...collect(full))
    else files.push(full)
  }
  return files
}

const files = collect(extDir)
const rel = files.map(f => relative(extDir, f).split(sep).join('/'))

// manifest 와 코드가 참조하는 파일이 빠지지 않았는지 확인
const required = new Set([manifest.background?.service_worker, manifest.side_panel?.default_path].filter(Boolean))
for (const f of files.filter(f => /\.(js|html)$/.test(f))) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|src=|href=)['"]\.?\/?([\w./-]+\.(?:js|css|html|json))['"]/g)) required.add(m[1])
  for (const m of src.matchAll(/files\s*:\s*\[([^\]]+)\]/g)) for (const n of m[1].matchAll(/['"]([\w./-]+)['"]/g)) required.add(n[1])
}
const missing = [...required].filter(r => !rel.includes(r))
if (missing.length) {
  console.error(`zip 에 빠진 파일이 있습니다: ${missing.join(', ')}`)
  process.exit(1)
}

// --- 최소 zip 작성기 (deflate, 고정 시각 → 같은 입력이면 같은 결과) ---
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1 // 2026-01-01 00:00

const locals = [], centrals = []
let offset = 0
files.forEach((file, i) => {
  const name = Buffer.from(rel[i], 'utf8')
  const data = readFileSync(file)
  const packed = deflateRawSync(data, { level: 9 })
  const crc = crc32(data)

  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6) // UTF-8 이름
  lh.writeUInt16LE(8, 8); lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12)
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(data.length, 22)
  lh.writeUInt16LE(name.length, 26)
  locals.push(lh, name, packed)

  const ch = Buffer.alloc(46)
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8)
  ch.writeUInt16LE(8, 10); ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14)
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(data.length, 24)
  ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42)
  centrals.push(ch, name)

  offset += lh.length + name.length + packed.length
})
const central = Buffer.concat(centrals)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
const zip = Buffer.concat([...locals, central, end])

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, zipName), zip)
const info = {
  name: manifest.name,
  version,
  file: `/downloads/${zipName}`,
  folder,
  bytes: zip.length,
  sha256: createHash('sha256').update(zip).digest('hex'),
  minimumChromeVersion: manifest.minimum_chrome_version ?? null,
  files: rel.length,
}
writeFileSync(join(outDir, 'extension.json'), JSON.stringify(info, null, 2) + '\n')
console.log(`${zipName} (${version}, 파일 ${rel.length}개, ${(zip.length / 1024).toFixed(1)}KB) → frontend/public/downloads/`)
