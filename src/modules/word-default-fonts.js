const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A='http://schemas.openxmlformats.org/drawingml/2006/main'
const child=(el,name,ns=W)=>Array.from(el?.children || []).find(n=>n.namespaceURI===ns && n.localName===name)
const attr=(el,name)=>el?.getAttributeNS(W,name)

function scriptOf(language) {
  if (!language) return
  try { return new Intl.Locale(language).maximize().script } catch { return undefined }
}

function resolveTheme(theme,key,languages) {
  if (!/^(major|minor)(EastAsia|Ascii|HAnsi|Bidi)$/.test(key)) return
  const family=theme?.getElementsByTagNameNS(A,key.startsWith('major')?'majorFont':'minorFont')[0]
  if (!family) return
  const east=key.endsWith('EastAsia'), complex=key.endsWith('Bidi')
  const language=attr(languages,east?'eastAsia':complex?'bidi':'val')
  const script=scriptOf(language)
  const fallback=child(family,east?'ea':complex?'cs':'latin',A)?.getAttribute('typeface')
  return (script && [...family.getElementsByTagNameNS(A,'font')].find(el=>el.getAttribute('script')===script)?.getAttribute('typeface')) || fallback
}

export function defaultTextFromStyles(styles,theme,settings) {
  const defaults={}, byId=new Map(), chain=[]
  let normal
  for (const el of styles?.getElementsByTagNameNS(W,'style') || []) {
    if (attr(el,'type')!=='paragraph') continue
    byId.set(attr(el,'styleId'),el)
    if (['1','true','on'].includes(attr(el,'default'))) normal=el
  }
  const seen=new Set()
  for (let el=normal || byId.get('Normal'); el && !seen.has(el); el=byId.get(attr(child(el,'basedOn'),'val'))) {
    seen.add(el);chain.push(child(el,'rPr'))
  }
  const root=child(child(child(styles,'docDefaults'),'rPrDefault'),'rPr')
  const languages=child(settings,'themeFontLang')
  for (const pr of [root,...chain.reverse()]) {
    const fonts=child(pr,'rFonts')
    const fontFor=key=>resolveTheme(theme,attr(fonts,key+'Theme'),languages) || attr(fonts,key)
    const font=fontFor('eastAsia'), latinFont=fontFor('ascii') || fontFor('hAnsi')
    const size=Number(attr(child(pr,'sz'),'val'))/2
    if (font) defaults.font=font
    if (latinFont) defaults.latinFont=latinFont
    if (size>=.5 && size<=819) defaults.size=size
  }
  return defaults
}
