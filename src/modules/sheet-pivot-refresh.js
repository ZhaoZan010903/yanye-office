import { refreshPivot } from './sheet-pivot.js'

// Refresh dependent reports after their data source. Commit the resulting
// workbook once so an invalid report cannot leave a half-refreshed workbook.
export function refreshReports(book, currentId) {
  const reports = book.sheets.filter(sheet => sheet.pivot && (currentId == null || sheet.id === currentId))
  if (!reports.length) return book
  const indices = new Map(book.sheets.map((sheet, index) => [sheet.id, index]))
  const result = { ...book, sheets: [...book.sheets] }
  const done = new Set(), pending = new Set()
  function refresh(sheet) {
    if (done.has(sheet.id)) return
    if (pending.has(sheet.id)) throw Error('透视表的数据源互相引用，无法全部刷新。')
    pending.add(sheet.id)
    if (currentId == null) {
      const source = result.sheets[indices.get(sheet.pivot.sourceId)]
      if (source?.pivot) refresh(source)
    }
    result.sheets[indices.get(sheet.id)] = refreshPivot(result, sheet)
    pending.delete(sheet.id)
    done.add(sheet.id)
  }
  reports.forEach(refresh)
  return result
}
