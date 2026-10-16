// Match Magpie's per-agent visibility before building a Kimi model menu.
// Read no credentials and never change the user's selections.
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const glob=(pattern,value)=>new RegExp('^'+String(pattern).split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i').test(value);

export function filterModelCatalog(payload,settings={},providers={},agent='kimi-desktop') {
  if(!Array.isArray(payload?.data))throw Error('catalog_invalid');
  const picked=own(settings.pickedModels,agent)?new Set(settings.pickedModels[agent]):null;
  const hidden=new Set(settings.hiddenModels?.[agent]||[]);
  const visible=own(settings.visible,agent)?settings.visible[agent].map(x=>x.toLowerCase()):null;
  const disabled=settings.disabledModels||[];
  const family=new Map((providers.providers||[]).map(p=>[p.id,p.family]));
  const groups=new Map((providers.groups||[]).map(g=>[g.id,g.family]));
  const data=payload.data.filter(row=>{
    const id=row.id;
    if(typeof id!=='string')return false;
    const slash=id.indexOf('/'),provider=id.slice(0,slash),model=id.slice(slash+1);
    if(disabled.some(p=>glob(p,id)||glob(p,model)))return false;
    if(visible) {
      const names=provider==='group'?[model,id,groups.get(model)]:[provider,family.get(provider)];
      if(!names.some(x=>x&&visible.includes(x.toLowerCase())))return false;
    }
    return picked?picked.has(id):!hidden.has(id);
  });
  const order=new Map((settings.orderedModels?.[agent]||[]).map((id,i)=>[id,i]));
  data.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
  return {...payload,data};
}
