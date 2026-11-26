export const standardWordMargins=Object.freeze({top:25.4,bottom:25.4,left:31.8,right:31.8})

export function newWordContent() {
  return {textDefaults:{font:'宋体',latinFont:'宋体',size:10.5},
    layout:{paper:'A4',landscape:false,...standardWordMargins}}
}
