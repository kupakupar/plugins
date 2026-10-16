import {test,expect} from 'bun:test';
import {filterModelCatalog} from './selection.mjs';
import {normalizeModels} from './catalog.mjs';
import hook from './menu-hook.cjs';

const data=['work/k3','work/preview','group/selected','other/hidden','new/new-model'].map(id=>({id,display_name:id}));
test('the Kimi menu follows its three picked models and never exposes a new global model',()=>{
  const picked=['work/k3','work/preview','group/selected'];
  const s={pickedModels:{'kimi-desktop':picked},hiddenModels:{'kimi-desktop':['work/k3']}};
  expect(filterModelCatalog({data},s).data.map(x=>x.id)).toEqual(picked);
  s.pickedModels['kimi-desktop']=[];
  expect(normalizeModels(filterModelCatalog({data},s),{allowEmpty:true})).toEqual([]);
});
test('legacy hidden models, provider families, global disables and per-agent order are respected',()=>{
  const s={visible:{'kimi-desktop':['subscription','group/selected']},hiddenModels:{'kimi-desktop':['work/preview']},
    disabledModels:['*hidden*'],orderedModels:{'kimi-desktop':['group/selected','work/k3']}};
  expect(filterModelCatalog({data},s,{providers:[{id:'work',family:'subscription'}]}).data.map(x=>x.id)).toEqual(['group/selected','work/k3']);
});
test('a connected exclusive catalog has only its three entries and disconnect restores native choices',()=>{
  const rows=normalizeModels({data:data.slice(0,3)}).map(x=>x.menu);
  const original={models:[{key:'native',modelAlias:'native'}],moreModels:[{key:'extra',modelAlias:'extra'}],defaultModelKey:'native'};
  const catalog={schemaVersion:1,enabled:true,exclusive:true,updatedAt:new Date().toISOString(),models:rows,selectedAlias:rows[0].key};
  const merged=hook._internal.mergeCatalog(original,catalog);
  expect(merged.models).toHaveLength(3);expect(merged.moreModels).toEqual([]);
  expect(merged.defaultModelKey).toBe(rows[0].key);
  expect(hook._internal.mergeCatalog(original,{...catalog,enabled:false}).models).toEqual(original.models);
});
