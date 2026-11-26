const common = ['java', 'javascript', 'typescript', 'python', 'rust', 'c', 'cpp', 'csharp', 'go',
  'html', 'css', 'json', 'sql', 'bash', 'powershell', 'yaml', 'xml', 'markdown', 'mermaid', 'flow', 'sequence', 'math', 'latex']
let catalog = common
let loading: Promise<void> | undefined
let engine: ReturnType<typeof import('lowlight').createLowlight> | undefined
type HighlightNode = ReturnType<NonNullable<typeof engine>['highlight']>['children'][number]

export function loadLanguages() {
  loading ??= import('lowlight').then(({ createLowlight, all }) => {
    engine = createLowlight(all)
    catalog = [...new Set([...common, ...engine.listLanguages()])]
  }).catch(error => { loading = undefined; throw error })
  return loading
}

export function languageSuggestions(prefix: string) {
  const search = prefix.trim().toLowerCase()
  return catalog.filter(name => name.startsWith(search)).slice(0, 12)
}

export interface HighlightSpan { from: number; to: number; classes: string }

// Diagram grammars belong to Typora's flowchart.js and js-sequence-diagrams
// fences. Keep UTF-16 offsets in the original text for both editor engines.
function diagramTokens(language: string, source: string): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  for (const match of source.matchAll(/[^\r\n]+/gu)) {
    const line = match[0], start = match.index
    const add = (from: number, to: number, scope: string) => {
      while (from < to && /\s/u.test(line[from])) from++
      while (to > from && /\s/u.test(line[to - 1])) to--
      if (to > from) spans.push({ from: start + from, to: start + to, classes: 'hljs-' + scope })
    }
    if (/^\s*#/u.test(line)) { add(0, line.length, 'comment'); continue }
    const colon = line.indexOf(':'), end = colon < 0 ? line.length : colon
    const statement = line.slice(0, end)
    if (language === 'flow') {
      const declaration = statement.indexOf('=>')
      if (declaration >= 0) {
        add(0, declaration, 'title')
        add(declaration, declaration + 2, 'built_in')
        add(declaration + 2, end, 'keyword')
      } else {
        for (const token of statement.matchAll(/->|\([^()]*\)?|(?:[\p{L}\p{M}\p{N}_.$]|-(?!>))+/gu)) {
          const value = token[0]
          const scope = value === '->' ? 'built_in' : value.startsWith('(') ? 'literal' : 'title'
          add(token.index, token.index + value.length, scope)
        }
      }
    } else {
      const directive = /^\s*(title(?=\s*$)|participant(?=\s)|note\s+(?:left\s+of|right\s+of|over)(?=\s|$))/iu.exec(statement)
      if (directive) {
        const after = directive[0].length
        add(0, after, 'keyword')
        if (/^participant$/iu.test(directive[1])) {
          const rest = statement.slice(after), alias = /\s+as\s+/iu.exec(rest)
          if (alias) {
            add(after, after + alias.index, 'title')
            add(after + alias.index, after + alias.index + alias[0].length, 'keyword')
            add(after + alias.index + alias[0].length, end, 'title')
          } else add(after, end, 'title')
        } else {
          for (const actor of statement.slice(after).matchAll(/[^,]+/gu)) {
            add(after + actor.index, after + actor.index + actor[0].length, 'title')
          }
        }
      } else {
        const arrow = /--?>>?/u.exec(statement) ?? /--?/u.exec(statement)
        if (arrow) {
          add(0, arrow.index, 'title')
          add(arrow.index, arrow.index + arrow[0].length, 'built_in')
          add(arrow.index + arrow[0].length, end, 'title')
        }
      }
    }
    if (colon >= 0) add(colon + 1, line.length, 'string')
  }
  return spans
}

export function highlightFence(language: string, source: string): HighlightSpan[] {
  if (!source || source.length > 48000) return []
  if (language === 'flow' || language === 'sequence') return diagramTokens(language, source)
  if (!engine?.registered(language)) return []
  let offset = 0
  const spans: HighlightSpan[] = []
  function visit(node: HighlightNode, inherited: string[]) {
    if (node.type === 'text') {
      const end = offset + node.value.length
      if (inherited.length && end > offset) spans.push({ from: offset, to: end, classes: inherited.join(' ') })
      offset = end
    } else if (node.type === 'element') {
      const local = node.properties.className
      const classes = Array.isArray(local) ? inherited.concat(local.map(String)) : inherited
      node.children.forEach(child => visit(child, classes))
    }
  }
  for (const child of engine.highlight(language, source).children) visit(child, [])
  return spans
}
