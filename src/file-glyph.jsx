import React from 'react'

const marks = {
  docx: <><path d="M7 9h10M7 12h7M7 15h10M7 18h6"/></>,
  xlsx: <><rect x="6.5" y="9" width="11" height="9" rx=".6"/><path d="M6.5 12h11M6.5 15h11M11 9v9"/></>,
  pptx: <><path d="M6 9h12v7H6zM12 16v3m-3 0 3-2 3 2"/><path d="m8 14 2.5-2.5 2 1.5 3-3"/></>,
  pdf: <><path d="M7 17c2-2 4-6 4.5-9 .3-2-1.6-1.3-1 1.5.7 3.3 3 5.2 6 5.6 2.3.3 1.7-1.6-.2-1.5-2.7 0-6.4 1.1-8.4 3-1.3 1.3-1.9 1.8-.9.4z"/></>,
  md: <><path d="M5.8 16v-5.3L8.5 14l2.7-3.3V16m4.3-5.5v6m-2.1-2.2 2.1 2.2 2.1-2.2"/></>,
  txt: <><path d="M7 9h9M7 12h7M7 15h9M7 18h5"/></>,
}

// The folded sheet and inner mark identify each format at tab and tile sizes.
export function FileGlyph({ extension, size=18 }) {
  if (extension==='xlsm') extension='xlsx'
  if (!Object.hasOwn(marks,extension)) return null
  return <svg className={'file-glyph type-'+extension} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d="M4 2h10.4L20 7.6V21a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="var(--file-tint)" stroke="var(--file-ink)" strokeWidth="1.25" strokeLinejoin="round"/>
    <path d="M14.4 2v5.6H20" fill="var(--file-fold)" stroke="var(--file-ink)" strokeWidth="1.1" strokeLinejoin="round"/>
    <g stroke="var(--file-ink)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{marks[extension]}</g>
  </svg>
}
