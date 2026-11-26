import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { writeDocx } from '../src/modules/word-docx.js'
import { wordValue, findText } from '../src/modules/word-model.js'
import { Schema } from '@tiptap/pm/model'

test('新建 Word 文件包含可读取的 Office 包、正文和页面设置', async () => {
  const book=await JSZip.loadAsync(await writeDocx({}),{base64:true})
  for(const part of ['[Content_Types].xml','_rels/.rels','word/document.xml','word/_rels/document.xml.rels','word/styles.xml','word/numbering.xml']) assert.ok(book.file(part),part)
  const body=await book.file('word/document.xml').async('string')
  assert.match(body,/<w:pgSz w:w="11906" w:h="16838"/)
  assert.match(body,/<w:pgMar w:top="1440"/)
})

test('Word 保存字符属性、编号、图片、表格合并和分页为可编辑 OOXML 元素', async () => {
  const p=text=>({type:'paragraph',content:[{type:'text',text}]})
  const cell=(text,span=1,height=1)=>({type:'tableCell',attrs:{colspan:span,rowspan:height},content:[p(text)]})
  const list={type:'orderedList',attrs:{start:3},content:[{type:'listItem',content:[p('收集凭证')]}]}
  const inline={type:'image',attrs:{width:10,height:10,alt:'小图',src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ioAAAAASUVORK5CYII='}}
  const value={layout:{paper:'Letter',landscape:true,left:12.7},doc:{type:'doc',content:[
    {type:'heading',attrs:{level:2,align:'center',lineSpacing:1.5},content:[{type:'text',text:'砚页 & Word',marks:[{type:'bold'},{type:'wordStyle',attrs:{color:'#234567',size:14,font:'SimSun'}}]}]},
    list,{type:'table',content:[{type:'tableRow',content:[cell('项目',1,2),cell('合计',2)]},{type:'tableRow',content:[cell('一'),cell('二')]}]},
    {type:'pageBreak'},{type:'paragraph',content:[inline]}]}}
  const file=await JSZip.loadAsync(await writeDocx(value),{base64:true})
  const xml=await file.file('word/document.xml').async('string')
  for(const token of ['砚页 &amp; Word','w:val="Heading2"','w:val="234567"','w:val="28"','w:eastAsia="SimSun"','w:line="360"','w:val="center"','<w:numPr>','<w:vMerge/>','<w:gridSpan w:val="2"','r:embed="rImage1"','w:type="page"','w:orient="landscape"'])assert.ok(xml.includes(token),token)
  assert.match(await file.file('word/numbering.xml').async('string'),/w:startOverride w:val="3"/)
  assert.ok(file.file('word/media/image1.png'))
})

test('Word 查找跨字符格式、分开段落和内嵌对象', () => {
  const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'(text|hardBreak)*'},text:{inline:true},hardBreak:{inline:true}},marks:{bold:{}}})
  const p=schema.node('paragraph',null,[schema.text('预算'),schema.text('说明',[schema.mark('bold')]),schema.node('hardBreak'),schema.text('说明')])
  const doc=schema.node('doc',null,[p,p])
  assert.deepEqual(findText(doc,'算说'),[{from:2,to:4},{from:11,to:13}])
  assert.equal(findText(doc,'明说').length,0)
  assert.equal(findText(doc,'说明').length,4)
  assert.equal(wordValue({layout:{paper:'other',top:-20}}).layout.top,0)
})
