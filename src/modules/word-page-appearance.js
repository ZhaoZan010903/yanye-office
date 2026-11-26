// Word keeps the paper color on the document and page borders on each section.
// Preserve the native side properties until the user chooses a new frame.
const sides = ['top', 'left', 'bottom', 'right']
const styles = {single:'solid', double:'double', dashed:'dashed', dotted:'dotted'}

export function borderPreset(layout) {
  const borders = layout.nativeSection?.pgBorders
  if (!borders) return 'none'
  const rules = sides.map(side => borders.children?.find(node => node.tag === side)?.attributes)
  if (rules.every(rule => !rule || ['none','nil'].includes(rule.val))) return 'none'
  const first = rules[0]
  return first && Object.hasOwn(styles, first.val) && rules.every(rule => rule?.val === first.val)
    ? first.val : 'custom'
}

export function setPageBorder(layout, preset) {
  const nativeSection = {...layout.nativeSection}
  if (preset === 'none') delete nativeSection.pgBorders
  else if (Object.hasOwn(styles, preset)) {
    nativeSection.pgBorders = {tag:'pgBorders', attributes:{offsetFrom:'page'}, children:sides.map(side => ({
      tag:side, attributes:{val:preset, sz:preset === 'double' ? '18' : '8', space:'18', color:'37352F'},
    }))}
  }
  return {nativeSection}
}

export function pageBorderStyle(layout) {
  const borders = layout.nativeSection?.pgBorders
  if (!borders || borders.attributes?.display === 'notFirstPage') return null
  const style = {}
  for (const side of sides) {
    const rule = borders.children?.find(node => node.tag === side)?.attributes
    if (!rule || !Object.hasOwn(styles, rule.val)) continue
    const space = Math.min(31, Math.max(0, Number(rule.space) || 0))
    style[side] = borders.attributes?.offsetFrom === 'page' ? space+'pt' : 'calc('+layout[side]+'mm - '+space+'pt)'
    // Chromium paints a double border as a single stroke below three pixels.
    const minimum = rule.val === 'double' ? 2.25 : .25
    const width = Math.min(12, Math.max(minimum, (Number(rule.sz) || 8) / 8))
    const color = /^[a-f0-9]{6}$/i.test(rule.color) ? '#'+rule.color : '#37352f'
    style['border'+side[0].toUpperCase()+side.slice(1)] = width+'pt '+styles[rule.val]+' '+color
  }
  return Object.keys(style).length ? style : null
}
