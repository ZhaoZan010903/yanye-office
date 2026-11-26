import { execFile, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// Tauri builds the frontend, embeds the assets in the executable, then creates
// the installer. Collect both Windows distributions under versioned names.
const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const output = join(root, 'release')
const built = join(process.env.CARGO_TARGET_DIR || join(root, 'src-tauri', 'target'), 'release')
const binaries = join(built, 'bundle', 'nsis')
const files = (await readdir(built)).filter(file => /\.dll$/i.test(file))
// With the GNU LLVM toolchain the WebView2 loader is a DLL. Include any
// target runtime libraries next to the executable in both distributions.
const resources = Object.fromEntries(files.map(file => [join(built, file), file]))
const cli = join(dirname(createRequire(import.meta.url).resolve('@tauri-apps/cli/package.json')), 'tauri.js')
const bundled = spawnSync(process.execPath, [cli, 'bundle', '--bundles', 'nsis', '--config',
  JSON.stringify({ bundle: { resources } })], { cwd: root, stdio: 'inherit' })
if (bundled.error) throw bundled.error
if (bundled.status !== 0) throw new Error('Windows 安装包构建失败。')
const installer = (await readdir(binaries)).find(name => name.includes(version + '_') && /x64.*setup\.exe$/i.test(name))
if (!installer) throw new Error('未找到本次构建生成的 Windows x64 安装程序。')
const name = 'YanYe-' + version + '-windows-x64'
const portable = join(output, name)
await mkdir(portable, { recursive: true })
for (const file of files) await copyFile(join(built, file), join(portable, file))
await copyFile(join(built, 'yanye.exe'), join(portable, 'YanYe.exe'))
await copyFile(join(root, 'LICENSE'), join(portable, 'LICENSE'))
await copyFile(join(root, 'dist', 'third-party-licenses.md'), join(portable, 'third-party-licenses.md'))
await promisify(execFile)('tar.exe', ['-a', '-cf', join(output, name + '.zip'), '-C', portable,
  'YanYe.exe', 'LICENSE', 'third-party-licenses.md', ...files])
await copyFile(join(binaries, installer), join(output, name + '-setup.exe'))
console.log(join(output, name + '.zip'), join(output, name + '-setup.exe'))
