import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileLibrary } from '../electron/library.mjs'
import { decodeText, detectEncoding, encodeText } from '../src/modules/plain-text.js'
import { textAfterEdit, txtEditorState } from '../src/modules/txt-history.js'
import { readOfficeFile, writeOfficeFile } from '../src/office-files.js'

test('TXT retains BOM, mixed line endings, blank lines and a missing final newline', () => {
  const sample = '第一行\r\n\r\n第三行\n第四行\r最后'
  for (const encoding of ['utf-8','utf-16le','utf-16be']) {
    const bytes = Buffer.from(encoding === 'utf-8' ? Buffer.from('\ufeff'+sample) : Buffer.from('\ufeff'+sample,'utf16le'))
    if (encoding === 'utf-16be') bytes.swap16()
    assert.equal(detectEncoding(bytes),encoding)
    const data = decodeText(bytes,encoding)
    assert.equal(data.text,'第一行\n\n第三行\n第四行\n最后')
    assert.deepEqual(Buffer.from(encodeText(data),'base64'), bytes)
    const state = txtEditorState(data, [])
    const tx = state.update({ changes:[{from:0,to:1,insert:'改'},{from:state.doc.line(4).to,insert:'\n新行'}] })
    const next = textAfterEdit(data, tx)
    const actual = new TextDecoder(encoding).decode(Buffer.from(encodeText(next),'base64'))
    assert.equal(actual, sample.replace('第','改').replace('第四行','第四行\r\n新行'))
  }
})

test('unknown TXT encoding asks before decode, canceled preview creates no draft, and conversion writes UTF-8', async () => {
  const bytes=Buffer.from([0xd6,0xd0,0xce,0xc4])
  assert.equal(detectEncoding(bytes),null)
  const file={name:'旧编码.txt',extension:'txt',content:bytes.toString('base64')}
  assert.equal(await readOfficeFile(file,()=>null),null)
  const page = {kind:'txt', ...await readOfficeFile(file,()=> 'gb18030')}
  assert.equal(page.content.text,'中文')
  assert.equal(Buffer.from(await writeOfficeFile(page),'base64').toString(), '中文')
})

test('PDF binding stores no bytes; copy keeps original bytes, rejects a changed original or existing target', async t => {
  const dir = await mkdtemp(join(tmpdir(),'yanye-readers-'))
  t.after(() => rm(dir,{recursive:true,force:true,maxRetries:3}))
  const prof=join(dir,'profile')
  await mkdir(prof)
  const source=join(dir,'source.pdf'), target=join(dir,'copy.pdf'), bytes=Buffer.from('%PDF-1.7\nfixture')
  await writeFile(source,bytes)
  let destination=target
  const library = new FileLibrary(prof,{chooseOpen:()=>source,chooseSave:()=>destination})
  const opened = await library.invoke('chooseOpen')
  assert.deepEqual(await readOfficeFile(opened),{content:{}})
  assert.equal(opened.content,null)
  assert.deepEqual(Buffer.from(await library.invoke('readPdf', opened.id,opened.revision)),bytes)
  const copy = await library.invoke('copyPdf',opened.id,opened.revision)
  assert.notEqual(opened.id,copy.id)
  assert.deepEqual(await readFile(target),bytes)
  destination=source
  await assert.rejects(library.invoke('copyPdf',opened.id,opened.revision), /同名/)
  await assert.rejects(library.invoke('save',{id:opened.id,name:'source.pdf',extension:'pdf',content:'stale'}), /保留原件/)
  await writeFile(source,'changed outside')
  await assert.rejects(library.invoke('readPdf',opened.id,opened.revision),/原件已变化/)
  assert.equal(await readFile(source,'utf8'),'changed outside')
})
