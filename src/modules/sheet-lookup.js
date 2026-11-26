const fail=code=>{throw new Error(code)}
const areaOf=arg=>arg?.area?.()??fail('#VALUE!')
const excelErrors=new Set(['#N/A','#VALUE!','#REF!','#DIV/0!','#NAME?','#NUM!','#NULL!'])

export function ifError(args) {
  if(args.length!==2) fail('#VALUE!')
  try {return args[0]()}
  catch(error) {if(!excelErrors.has(error.message)) throw error;return args[1]()}
}

export function vlookup(args,numberOf,compare,criterionMatches) {
  if(args.length<3 || args.length>4) fail('#VALUE!')
  const needle=args[0](), table=areaOf(args[1]), index=Math.trunc(numberOf(args[2]()))
  const approx=args.length===3 || numberOf(args[3]())!==0
  if(Array.isArray(needle) || index<1) fail('#VALUE!')
  if(index>table.cols) fail('#REF!')
  const wildcard=!approx && typeof needle==='string' && /[~*?]/.test(needle) ? criterionMatches('='+needle) : null
  let found=-1
  for(let row=0;row<table.rows;row++) {
    const candidate=table.at(row,0)
    if(!approx) {
      if(wildcard?wildcard(candidate):compare(candidate,needle,'=')) {found=row;break}
    } else {
      if(candidate===null || typeof candidate!==typeof needle) continue
      if(compare(candidate,needle,'>')) break
      found=row
    }
  }
  return found<0?fail('#N/A'):table.at(found,index-1)??0
}

export function conditionalAggregate(name,args,criterionMatches) {
  const sum=name==='SUMIFS', offset=sum?1:0
  if(args.length<offset+2 || (args.length-offset)%2 || args.length>254+offset) fail('#VALUE!')
  const basis=areaOf(args[0]), tests=[]
  for(let i=offset;i<args.length;i+=2) {
    const range=areaOf(args[i]), criterion=args[i+1]()
    if(Array.isArray(criterion) || range.rows!==basis.rows || range.cols!==basis.cols) fail('#VALUE!')
    tests.push({range,match:criterionMatches(criterion)})
  }
  let total=0
  for(let r=0;r<basis.rows;r++) for(let c=0;c<basis.cols;c++) {
    if(!tests.every(t=>t.match(t.range.at(r,c)))) continue
    const value=sum?basis.at(r,c):1
    if(typeof value==='number') total+=value
  }
  return total
}
