import { packager } from '@electron/packager'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const release = resolve(root, 'release')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
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
    electronVersion: pkg.devDependencies.electron,
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
