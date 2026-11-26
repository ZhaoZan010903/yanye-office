import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { history, redo, undo } from '@codemirror/commands'
import { EditorSelection, Transaction } from '@codemirror/state'
import { describeSource } from '../src/markdown.js'
import { markdownFigures } from '../src/markdown-figures.js'
import { editSource, editorSource, markdownMatches } from '../src/markdown-search.js'
import { bookmarks, editLines, jumpBookmark, restoreBookmarks, toggleBookmark } from '../src/modules/txt-commands.js'
import { decodeText, encodeText } from '../src/modules/plain-text.js'
import { convertFileFormat, textAfterEdit, txtEditorState } from '../src/modules/txt-history.js'
import { readOfficeFile, writeOfficeFile } from '../src/office-files.js'

function openText(bytes) {
  let model=decodeText(bytes,'utf-8'), state=txtEditorState(model,[history(),bookmarks])
  return {
    get state() { return state },
    get model() { return model },
    bytes() { return Buffer.from(encodeText(model),'base64') },
    dispatch(spec) {
      const tr=spec instanceof Transaction ? spec : state.update(spec)
      model=textAfterEdit(model,tr)
      state=tr.state
    },
  }
}

test('Markdown search covers words across marks and stops at objects and paragraph boundaries',()=>{
  const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'inline*'},text:{group:'inline'},image:{inline:true,group:'inline'}},marks:{bold:{}}})
  const paragraph=(...pieces)=>schema.node('paragraph',null,pieces)
  const doc=schema.node('doc',null,[paragraph(schema.text('系'),schema.text('统',[schema.mark('bold')]),schema.node('image'),schema.text('A.')), paragraph(schema.text('a.😀'))])
  assert.deepEqual(markdownMatches(doc,'系统',true),[{from:1,to:3}])
  assert.deepEqual(markdownMatches(doc,'统A',false),[])
  assert.deepEqual(markdownMatches(doc,'.a',false),[])
  assert.equal(markdownMatches(doc,'a.',false).length,2)
  assert.equal(markdownMatches(doc,'a.',true).length,1)
  assert.equal(markdownMatches('A'.repeat(60000),'a',false).length,10001)
  assert.deepEqual(markdownMatches('literal: [x]. $', '[x].', false),[{from:9,to:13}])
})

test('Markdown source edits keep untouched CRLF, LF and CR separators across a Unicode edit',()=>{
  const raw='😀记录\r\n甲\n乙\r丙\r\n', shown=editorSource(raw)
  const changed=editSource(raw,shown.replace('乙','展开\n乙'))
  assert.equal(changed,'😀记录\r\n甲\n展开\r\n乙\r丙\r\n')
  assert.equal(editSource(changed,shown),raw)
  assert.equal(editSource(raw,shown),raw)
  assert.equal(describeSource('$$\nx_1 / y_1\n$$').sourceOnly,true)
})

test('figures skip code and escaped/currency delimiters, retain source lines and recognize both fence types',()=>{
  const source=['片段 `$hidden$`；$x^2$。','\\$ignore$ and $10 and $20','```js','$no$','```','$$','a + b','$$',
    '~~~~mermaid','flowchart LR','  A --> B','~~~~','```math','a^2','```'].join('\r\n')
  const objects=markdownFigures(source)
  assert.deepEqual(objects.map(({kind,line,source})=>({kind,line,source})),[
    {kind:'inline',line:1,source:'x^2'}, {kind:'math',line:6,source:'a + b'},
    {kind:'mermaid',line:9,source:'flowchart LR\n  A --> B'}, {kind:'math',line:13,source:'a^2'},
  ])
  for(const obj of objects) assert.equal(editorSource(source).slice(obj.bodyStart,obj.bodyEnd),obj.source)
})

test('format conversion undoes and redoes original encoding, BOM and mixed endings byte-for-byte',()=>{
  const original=Buffer.from('\uFEFFA\r\n乙\nC\r末')
  const view=openText(original)
  convertFileFormat(view,{eol:'n'})
  assert.deepEqual(view.bytes(),Buffer.from('\uFEFFA\n乙\nC\n末'))
  convertFileFormat(view,{encoding:'utf-16le',bom:true})
  assert.deepEqual(view.bytes(),Buffer.from('\uFEFFA\n乙\nC\n末','utf16le'))
  assert.ok(undo(view))
  assert.equal(view.model.encoding,'utf-8')
  assert.ok(undo(view))
  assert.deepEqual(view.bytes(),original)
  assert.ok(redo(view))
  assert.equal(view.model.lineMap,undefined)
  assert.ok(redo(view))
  assert.equal(view.model.encoding,'utf-16le')
})

test('line tools preserve a trailing LF; multi-line selection excludes the following untouched line',()=>{
  const view=openText(Buffer.from('b2\nb10\nb2\na \n'))
  editLines(view,'unique')
  assert.equal(view.model.text,'b2\nb10\na \n')
  editLines(view,'sort')
  assert.equal(view.model.text,'a \nb2\nb10\n')
  view.dispatch({selection:{anchor:0,head:3}})
  editLines(view,'trim')
  assert.equal(view.model.text,'a\nb2\nb10\n')
  view.dispatch({selection:{anchor:0,head:1}})
  editLines(view,'upper')
  assert.equal(view.model.text,'A\nb2\nb10\n')
  assert.ok(undo(view))
  assert.equal(view.model.text,'a\nb2\nb10\n')
})

test('bookmarks follow insertions and cycle across first/last line from the cursor',()=>{
  const view=openText(Buffer.from('一\n二\n三'))
  restoreBookmarks(view,[2,3,0,8])
  view.dispatch({changes:{from:0,insert:'首\n'}})
  assert.deepEqual([...view.state.field(bookmarks)],[4,6])
  view.dispatch({selection:EditorSelection.cursor(6)})
  assert.ok(jumpBookmark(view,1))
  assert.equal(view.state.selection.main.head,4)
  assert.ok(jumpBookmark(view,-1))
  assert.equal(view.state.selection.main.head,6)
  toggleBookmark(view)
  assert.deepEqual([...view.state.field(bookmarks)],[4])
})

test('GB18030 reads and writes golden two-byte/four-byte mappings and mixed endings without substitution',async()=>{
  const bytes=Buffer.from('d6d0cec40d0a9439fc360a95328236','hex')
  const source={extension:'txt',name:'旧.txt',content:bytes.toString('base64')}
  const page={kind:'txt',...await readOfficeFile(source,()=> 'gb18030')}
  assert.equal(page.content.text,'中文\n😀\n𠀀')
  assert.equal(page.content.noncanonicalEncoding,undefined)
  assert.deepEqual(Buffer.from(await writeOfficeFile(page),'base64'),bytes)
  page.content.text+='新'
  assert.deepEqual(Buffer.from(await writeOfficeFile(page),'base64'),Buffer.concat([bytes,Buffer.from('d0c2','hex')]))
  page.content.text+='\uE5E5'
  await assert.rejects(writeOfficeFile(page),e=>e.code==='TEXT_UNENCODABLE' && e.message.includes('U+E5E5'))
})

test('GBK reports a supplementary character, protects aliases and never silently injects question marks',async()=>{
  const noncanonical={extension:'txt',name:'原件.txt',content:Buffer.from('d6d0a2e3','hex').toString('base64')}
  const page={kind:'txt',...await readOfficeFile(noncanonical,()=> 'gbk')}
  assert.equal(page.content.text,'中€')
  assert.equal(page.content.noncanonicalEncoding,'gbk')
  assert.deepEqual(Buffer.from(await writeOfficeFile(page),'base64'),Buffer.from('d6d080','hex'))
  page.content.text+='😀'
  await assert.rejects(writeOfficeFile(page),/GBK.*U\+1F600/)
  page.content.encoding='utf-8'
  assert.deepEqual(Buffer.from(await writeOfficeFile(page),'base64'),Buffer.from('中€😀'))
  page.content.text+='\uD800'
  await assert.rejects(writeOfficeFile(page),/UTF-16 代理项/)
})
