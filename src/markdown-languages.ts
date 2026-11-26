const common = ['java', 'javascript', 'typescript', 'python', 'rust', 'c', 'cpp', 'csharp', 'go',
  'html', 'css', 'json', 'sql', 'bash', 'powershell', 'yaml', 'xml', 'markdown', 'mermaid', 'math', 'latex']
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

export function highlightFence(language: string, source: string): HighlightSpan[] {
  if (!engine?.registered(language) || !source || source.length > 48000) return []
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
