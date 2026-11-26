import { createRoot } from 'react-dom/client'
import { installDesktop } from './desktop/bridge'
import './styles.css'
import './desktop-theme.css'

const root = createRoot(document.getElementById('root')!)

async function start() {
  await installDesktop()
  const { App } = await import('./App.jsx')
  root.render(<App />)
}

void start().catch(error => {
  root.render(<main className="boot-screen" role="alert"><h1>砚页无法启动</h1><p>{String(error)}</p>
    <button onClick={() => location.reload()}>重新打开</button></main>)
})
