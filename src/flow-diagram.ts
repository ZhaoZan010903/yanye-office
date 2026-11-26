import flowchart from 'flowchart.js'

type SymbolOptions = {link?:string; function?:string; lineStyle:Record<string,Record<string,unknown>>}

export function flowSvg(source: string) {
  const host = document.createElement('div')
  // Raphaël measures text from a connected SVG before laying out branches.
  host.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none'
  host.setAttribute('aria-hidden','true')
  document.body.append(host)
  try {
    const chart = flowchart.parse(source) as ReturnType<typeof flowchart.parse> & {symbols:Record<string,SymbolOptions>}
    for (const symbol of Object.values(chart.symbols)) {
      // The editor embeds a static illustration. Keep paint hints and discard
      // callback names, navigation targets and external paint-server URLs.
      delete symbol.link
      delete symbol.function
      for (const [target,style] of Object.entries(symbol.lineStyle)) {
        symbol.lineStyle[target] = Object.fromEntries(Object.entries(style).filter(([name,value])=>{
          if (name === 'stroke' || name === 'fill') return value === 'none' || (typeof value === 'string' && CSS.supports('color',value))
          if (name === 'stroke-width' || name === 'opacity') return Number.isFinite(Number(value))
          return name === 'stroke-dasharray' && typeof value === 'string' && /^[\d., \-]+$/u.test(value)
        }))
      }
    }
    chart.drawSVG(host, { 'font-family':'Segoe UI, Microsoft YaHei, sans-serif', 'font-size':14,
      'font-color':'#37352f','element-color':'#37352f','line-color':'#37352f','line-width':2, fill:'#ffffff' })
    const svg = host.querySelector('svg')
    if (!svg?.querySelector('text')) throw Error('流程图缺少可显示的节点或连线。')
    // Render as an inert image. Keep marker references local to that image.
    for (const link of svg.querySelectorAll('a')) link.replaceWith(...link.childNodes)
    for (const el of svg.querySelectorAll('*')) {
      for (const name of ['marker-start','marker-end','fill','stroke']) {
        const value = el.getAttribute(name)
        if (value?.startsWith('url(')) el.setAttribute(name,value.replace(/url\(['"]?[^#]*#([^)'"]+)['"]?\)/gu,'url(#$1)'))
      }
    }
    const markup = new XMLSerializer().serializeToString(svg)
    chart.clean()
    return markup
  } finally { host.remove() }
}
