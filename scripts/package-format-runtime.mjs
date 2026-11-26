import { execFile } from 'node:child_process'
import { access, copyFile, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root=fileURLToPath(new URL('../',import.meta.url))
const runtime=resolve(process.argv[2] || process.env.YANYE_LIBREOFFICE_ROOT || 'LibreOffice')
if (basename(runtime)!=='LibreOffice') throw Error('请指定包含 program 和 share 的 LibreOffice 目录。')
for (const file of ['program/soffice.com','program/soffice.bin','share/registry/main.xcd','LICENSE.html','NOTICE']) {
  await access(join(runtime,file))
}
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const name='YanYe-'+version+'-windows-x64'
const portable=join(root,'release',name)
await access(join(portable,'YanYe.exe'))
const temp=await mkdtemp(join(root,'release','full-'))
try {
  await copyFile(join(root,'docs','FORMAT_RUNTIME.md'),join(temp,'本地转换引擎.md'))
  const archive=join(temp,name+'-full.zip')
  await promisify(execFile)('tar.exe',['--options','zip:hdrcharset=UTF-8','-a','-cf',archive,'-C',portable,...await readdir(portable),'-C',temp,'本地转换引擎.md','-C',dirname(runtime),'LibreOffice'])
  const output=join(root,'release',basename(archive))
  await rename(archive,output)
  console.log(output)
} finally {
  await rm(temp,{recursive:true,force:true})
}
