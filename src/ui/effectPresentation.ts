import type { LogEntry } from '../game/types';

export interface EffectOccurrence {
  index: number;
  total: number;
}

function effectSignature(entry:LogEntry){
  return [entry.effectKind??'effect',entry.sourceRacerId??'',entry.targetRacerId??''].join(':');
}

function repeatedContentSignature(entry:LogEntry){
  return [effectSignature(entry),entry.text,entry.textEn].join('\u0000');
}

export function compactRepeatedEffects(entries:LogEntry[]):LogEntry[] {
  const counts=new Map<string,number>();
  entries.forEach(entry=>{const key=repeatedContentSignature(entry);counts.set(key,(counts.get(key)??0)+1);});
  const emitted=new Set<string>();
  const result:LogEntry[]=[];
  for(const entry of entries){
    const key=repeatedContentSignature(entry);const count=counts.get(key)??1;
    if(count<3){result.push(entry);continue;}
    if(emitted.has(key))continue;
    emitted.add(key);result.push({...entry,repeatCount:count});
  }
  return result;
}

export function effectOccurrence(entries:LogEntry[],currentIndex:number):EffectOccurrence {
  const current=entries[currentIndex];
  if(!current)return{index:1,total:1};
  const signature=effectSignature(current);
  const matches=entries.map((entry,index)=>({entry,index})).filter(({entry})=>effectSignature(entry)===signature);
  return{index:matches.filter(({index})=>index<=currentIndex).length,total:matches.length};
}

export function visibleEffectIndices(total:number,currentIndex:number,maxVisible=5){
  if(total<=0)return[];
  const count=Math.max(1,Math.min(maxVisible,total));
  const half=Math.floor(count/2);
  const start=Math.max(0,Math.min(total-count,currentIndex-half));
  return Array.from({length:count},(_,offset)=>start+offset);
}

export function effectChainRoot(entries:LogEntry[]){
  return entries.find(entry=>entry.sourceRacerId)?.sourceRacerId??null;
}
