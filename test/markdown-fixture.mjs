import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

export async function openMarkdownFixture(fixture, pixel = '') {
  const harness = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { DocumentEditor } from '/src/editor.jsx'
import '/src/styles.css'
function Harness() {
  window.yanye={library:{markdownResource:async(id,ref)=>{window.resource=[id,ref];return {mime:'image/png',data:` + JSON.stringify(pixel) + `}}}}
  const [page, setPage] = React.useState({id:'test',title:'样本',kind:'note',disk:{id:'local',extension:'md'},markdown:` + JSON.stringify(fixture) + `})
  window.saved = page.markdown
  return React.createElement(DocumentEditor, {page, children:[],saveState:{state:'saved'},
    onChange: change => {setPage(old => ({...old,...change}));return true}, onExternalLink(href){window.external=href},onOpenFileLink(ref){window.link=ref} })
}
createRoot(document.querySelector('main')).render(React.createElement(Harness))
`
  const cacheDir = await mkdtemp(join(tmpdir(), 'yanye-markdown-'))
  const server = await createServer({configFile:false, cacheDir, logLevel:'error',
    optimizeDeps:{entries:['src/editor.jsx'],include:['react-dom/client']},server:{host:'127.0.0.1',port:0,watch:null},
    plugins:[{name:'markdown-regression-fixture',resolveId(id){if(id === '/markdown-fixture.js')return id},
      load(id){if(id==='/markdown-fixture.js')return harness},
      configureServer(server){server.middlewares.use((req,res,next)=>{
        if (req.url !== '/markdown-fixture') return next()
        res.setHeader('Content-Type','text/html;charset=UTF-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><main></main><script type="module" src="/markdown-fixture.js"></script></html>')
      })}}]})
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({channel:process.env.MARKDOWN_BROWSER || 'msedge'})
    const page = await browser.newPage()
    page.setDefaultTimeout(18000)
    return {page, url:server.resolvedUrls.local[0]+'markdown-fixture', close}
  } catch (error) { await close(); throw error }
  async function close() {
    await browser?.close()
    await server.close()
    await rm(cacheDir,{recursive:true,force:true})
  }
}
