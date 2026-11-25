export function describeSource(markdown) {
  const normalized = markdown.replace(/\r\n?/gu, '\n')
  const lines = normalized.split('\n')
  const headings = []
  let offset = 0
  let fence = ''
  let total = 0
  let completed = 0
  let sourceOnly = false

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line))
    sourceOnly = end > 1 && lines.slice(1, end).some(line => /^\s*[\w-]+\s*:/u.test(line))
  }

  for (const [index, line] of lines.entries()) {
    const start = offset
    offset += line.length + 1
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? '' : marker
      continue
    }
    if (fence) continue

    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (heading) headings.push({ position: start, line: index, level: heading[1].length, label: heading[2] })

    const task = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\](?:\s+|$)/u.exec(line)
    if (task) {
      total += 1
      if (task[1] !== ' ') completed += 1
    }

    const plain = line.replace(/`[^`]*`/gu, '')
    if (/^ {0,3}\[\^?.+\]:\s|\[\^[^\]]+\]|<\/?[A-Za-z][A-Za-z\d-]*(?:\s|\/?>)|<!--|^ {0,3}:::/u.test(plain)) sourceOnly = true
  }

  return { headings, completed, total, characters: [...normalized.replace(/\s/gu, '')].length, sourceOnly }
}

export function describeDocument(editor) {
  const headings = []
  let total = 0
  let completed = 0
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'heading' && node.textContent) {
      headings.push({ position, level: node.attrs.level, label: node.textContent })
    } else if (node.type.name === 'taskItem') {
      total += 1
      if (node.attrs.checked) completed += 1
    }
  })
  const characters = [...editor.getText().replace(/\s/gu, '')].length
  return { headings, completed, total, characters }
}
