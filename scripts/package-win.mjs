import { packager } from '@electron/packager'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const release = resolve(root, 'release')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const electronVersion = pkg.devDependencies.electron
const electronZipDir = process.env.YANYE_ELECTRON_ZIP_DIR
if (electronZipDir) {
  const name = 'electron-v' + electronVersion + '-win32-x64.zip'
  const checksums = JSON.parse(await readFile(join(root, 'node_modules', 'electron', 'checksums.json'), 'utf8'))
  const sum = createHash('sha256')
  for await (const chunk of createReadStream(join(electronZipDir, name))) sum.update(chunk)
  if (sum.digest('hex') !== checksums[name]) throw new Error('Electron ZIP 校验失败，请检查文件与版本。')
}
await mkdir(release, { recursive: true })
const staging = await mkdtemp(join(release, 'package-input-'))

try {
  for (const directory of ['dist', 'electron', 'shared', 'assets']) {
    await cp(join(root, directory), join(staging, directory), { recursive: true })
  }
  await cp(join(root, 'LICENSE'), join(staging, 'LICENSE'))
  const { name, version, author, license, productName, description, type, main } = pkg
  await writeFile(join(staging, 'package.json'), JSON.stringify({ name, version, author, license, productName, description, type, main }))
  const paths = await packager({
    dir: staging,
    out: release,
    name: 'YanYe',
    executableName: 'YanYe',
    platform: 'win32',
    arch: 'x64',
    appVersion: version,
    electronVersion,
    electronZipDir,
    appBundleId: 'com.yanye.desktop',
    icon: join(root, 'assets', 'yanye.ico'),
    asar: true,
    prune: false,
    overwrite: true,
    win32metadata: { ProductName: productName, FileDescription: description, InternalName: 'YanYe' },
  })
  console.log(paths.map(path => join(path, 'YanYe.exe')).join('\n'))
} finally {
  if (dirname(staging) === release && basename(staging).startsWith('package-input-')) {
    await rm(staging, { recursive: true, force: true, maxRetries: 4 })
  }
}
