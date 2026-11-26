export function cellBorders(borders) {
  if (!borders) return
  const css={}
  for (const [side,property] of [['top','borderTop'],['bottom','borderBottom'],['left','borderLeft'],['right','borderRight']]) {
    const item=borders[side]
    if (!item?.style) continue
    const color=/^(?:[0-9a-f]{2})?[0-9a-f]{6}$/i.test(item.color?.argb) ? '#'+item.color.argb.slice(-6) : '#37352f'
    const stroke=item.style==='double' ? 'double' : /dash/i.test(item.style) ? 'dashed' : item.style==='dotted' ? 'dotted' : 'solid'
    const width=stroke==='double' || item.style==='thick' ? 3 : /medium/i.test(item.style) ? 2 : 1
    css[property]=width+'px '+stroke+' '+color
  }
  return css
}
