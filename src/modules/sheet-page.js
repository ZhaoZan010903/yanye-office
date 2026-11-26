import { address, parseRange } from './spreadsheet.js'

export const paperSizes = {1:'Letter',5:'Legal',8:'A3',9:'A4',11:'A5'}
export const marginPresets = {
  常规:{left:.7,right:.7,top:.75,bottom:.75,header:.3,footer:.3},
  窄:{left:.25,right:.25,top:.75,bottom:.75,header:.3,footer:.3},
  宽:{left:1,right:1,top:1,bottom:1,header:.5,footer:.5},
}

export function marginPreset(margins = marginPresets.常规) {
  return Object.keys(marginPresets).find(name =>
    Object.entries(marginPresets[name]).every(([side,n]) => Math.abs(n - margins[side]) < .001)) || ''
}

export function readPageSetup(setup = {}) {
  const result = {}
  for (const key of ['paperSize','orientation','margins','showGridLines','showRowColHeaders','horizontalCentered',
    'verticalCentered','fitToPage','fitToWidth','fitToHeight','scale','printTitlesRow','printTitlesColumn',
    'pageOrder','blackAndWhite','draft','firstPageNumber']) {
    if (setup[key] != null) result[key] = setup[key]
  }
  if (setup.printArea) result.areas = setup.printArea.split('&&').map(parseRange).filter(Boolean)
  return result
}

export function absoluteArea(box) {
  const absolute = (r,c) => address(r,c).replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')
  return absolute(box.top,box.left) + ':' + absolute(box.bottom,box.right)
}
