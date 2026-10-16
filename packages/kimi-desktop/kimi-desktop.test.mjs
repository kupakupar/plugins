import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { KimiAdapter } from './adapter.mjs';
import { controlEndpoint } from './rpc.mjs';
import { agent, connect } from './kimi-desktop.agent.js';

const official = 'https://agent-gw.kimi.com/coding/v1';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-kimi-fixture-'));
  const kimiDir = path.join(directory, 'kimi');
  const requests = [], tools = [], calls = [];
  const gateway = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({data:[{id:'original-provider/test-model',display_name:'First'}, {id:'other-provider/other-model',display_name:'Second'}]})); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_read","type":"function","function":{"name":"Read","arguments":"{}"}}]}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const controller = new KimiAdapter({ stateDir: path.join(directory, 'state'), kimiDir,
    stabilityMs: 0, intervalMs: 100000,
    rpcCall: async (_runner, method, params) => { calls.push({ method, params });
      if (method === 'conversations.getKimiModelList') return {models:[{model:'k2d8-preview'}]};
      return { current: 'k2d8-preview' }; },
    fetchImpl: async (url, options) => {
      if (String(url).startsWith('https://agent-gw.kimi.com/')) {
        tools.push({ url: String(url), authorization: options.headers.Authorization, body: JSON.parse(options.body) });
        return new Response('{"result":"official tool response"}', { headers: { 'Content-Type': 'application/json' } });
      }
      return fetch(url, options);
    },
  });
  const doc = { credentials: { kimiCode: { apiKey: 'synthetic-kimi-key', baseUrl: official, refreshToken: 'synthetic-refresh-before' } },
    model: { current: 'k2d8-preview', providers: { 'daimon-kimi-code': { type: 'kimi', baseUrl: official } },
      models: { 'k2d8-preview': { model: 'k2d8-preview', provider: 'daimon-kimi-code' } } },
    unrelated: { preserve: ['all', 'original', 'settings'] } };
  write(controller.configFile, doc);
  write(controller.runnerFile, { lifecycleStatus: 'running', daemonGeneration: 'synthetic-generation-1',
    activeKernelTurns: 0, activeKernelToolCalls: 0, control: { endpoint: { url: 'ws://127.0.0.1:3072/control', pid: 10, startedAt: 1 } } });
  controller.bootstrap();
  const connection = { schemaVersion: 1, enabled: true, model: 'original-provider/test-model',
    gateway: { url: 'http://127.0.0.1:' + gateway.address().port + '/v1', key: 'synthetic-magpie-key' }, requestId: 1 };
  write(controller.connectionFile, connection);
  return { directory, controller, doc, connection, requests, tools, calls,
    cleanup: async () => { await controller.stop(); gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('Work inference uses selected model and gateway auth; SSE tools survive; official fetch/search keep Kimi auth', async () => {
  const f = await fixture();
  try {
    await f.controller.tick();
    expect(f.controller.status.code).toBe('connected');
    const payload = { model: 'k2d8-preview', stream: true,
      messages: [{ role: 'system', content: 'synthetic original instruction' }, { role: 'user', content: 'synthetic request' }],
      tools: [{ type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }] };
    const response = await fetch(f.controller.bridgeURL + '/chat/completions', { method: 'POST',
      headers: { Authorization: 'Bearer synthetic-kimi-key', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('"name":"Read"');
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].authorization).toBe('Bearer synthetic-magpie-key');
    expect(f.requests[0].body).toEqual({ ...payload, model: 'original-provider/test-model' });
    for (const tool of ['fetch', 'search']) {
      const response = await fetch(f.controller.bridgeURL + '/' + tool, { method: 'POST', headers: {
        Authorization: 'Bearer synthetic-kimi-key', 'Content-Type': 'application/json' }, body: '{"query":"synthetic"}' });
      expect(response.status).toBe(200); await response.text();
    }
    expect(f.tools.map(x => x.url)).toEqual(['https://agent-gw.kimi.com/coding/v1/fetch', 'https://agent-gw.kimi.com/coding/v1/search']);
    expect(f.tools.every(x => x.authorization === 'Bearer synthetic-kimi-key')).toBe(true);
    const current = read(f.controller.configFile);
    expect(current.credentials).toEqual(f.doc.credentials);
    expect(current.model.current).toBe('k2d8-preview');
    expect(current.unrelated).toEqual(f.doc.unrelated);
    expect(f.calls.map(x => x.method)).toEqual(['models.current', 'conversations.setModel', 'conversations.getKimiModelList', 'conversations.updateKimiModelList']);
  } finally { await f.cleanup(); }
});

test('Kimi menu aliases route independently and removed models fail closed', async () => {
  const f = await fixture();
  try {
    await f.controller.tick();
    expect(f.controller.catalog.length).toBe(2);
    const menu = read(f.controller.catalogFile);
    expect(menu.models[0].displayName).toBe('First · Magpie');
    expect(f.calls.find(x => x.method === 'conversations.updateKimiModelList').params.models[0].model).toBe('k2d8-preview');
    const chosen = f.controller.catalog.find(x => x.id === 'other-provider/other-model');
    const response = await fetch(f.controller.bridgeURL + '/chat/completions', {method:'POST', headers:{Authorization:'Bearer synthetic-kimi-key'},
      body:JSON.stringify({model:chosen.alias,messages:[{role:'user',content:'synthetic'}]})});
    await response.text();
    expect(f.requests[0].body.model).toBe('other-provider/other-model');
    expect(f.requests[0].authorization).toBe('Bearer synthetic-magpie-key');
    f.controller.catalog = f.controller.catalog.filter(x => x.alias !== chosen.alias);
    const refused = await fetch(f.controller.bridgeURL + '/chat/completions', {method:'POST',headers:{Authorization:'Bearer synthetic-kimi-key'},
      body:JSON.stringify({model:chosen.alias,messages:[]})});
    expect(refused.status).toBe(409);
    expect(f.requests.length).toBe(1);
  } finally {await f.cleanup();}
});

test('disconnect restores one address while retaining refreshed credentials and unrelated changes', async () => {
  const f = await fixture();
  try {
    await f.controller.tick();
    const doc = read(f.controller.configFile);
    doc.credentials.kimiCode.refreshToken = 'synthetic-refresh-rotated';
    doc.unrelated.newSetting = 'preserved';
    write(f.controller.configFile, doc);
    write(f.controller.connectionFile, { ...f.connection, enabled: false });
    await f.controller.tick();
    expect(f.controller.status.code).toBe('disconnected');
    const after = read(f.controller.configFile);
    expect(after.model.providers['daimon-kimi-code'].baseUrl).toBe(official);
    expect(after.credentials.kimiCode.refreshToken).toBe('synthetic-refresh-rotated');
    expect(after.unrelated.newSetting).toBe('preserved');
    expect(f.calls.at(-1).method).toBe('conversations.setModel');
  } finally { await f.cleanup(); }
});

test('disconnect returns a selected menu alias to the original model without losing native entries', async () => {
  const f=await fixture();
  try {
    await f.controller.tick();
    let models=f.calls.find(x=>x.method==='conversations.updateKimiModelList').params.models;
    const base=f.controller.rpcCall;
    f.controller.rpcCall=async(runner,method,params)=>{
      if(method==='conversations.getKimiModelList')return {models};
      if(method==='conversations.updateKimiModelList')models=params.models;
      if(method==='conversations.setModel'){
        const doc=read(f.controller.configFile);doc.model.current=params.modelAlias;write(f.controller.configFile,doc);
      }
      return base(runner,method,params);
    };
    const doc=read(f.controller.configFile);doc.model.current=f.controller.catalog[1].alias;write(f.controller.configFile,doc);
    write(f.controller.connectionFile,{...f.connection,enabled:false});
    await f.controller.tick();
    expect(read(f.controller.configFile).model.current).toBe('k2d8-preview');
    expect(models).toEqual([{model:'k2d8-preview'}]);
    expect(read(f.controller.configFile).credentials).toEqual(f.doc.credentials);
    expect(read(f.controller.catalogFile).enabled).toBe(false);
  }finally{await f.cleanup();}
});

test('long Work turns keep the native menu alive without reloading the busy runtime', async () => {
  const f=await fixture();
  try {
    await f.controller.tick();
    const calls=f.calls.length;
    const catalog=read(f.controller.catalogFile);
    write(f.controller.catalogFile,{...catalog,updatedAt:'2000-01-01T00:00:00Z'});
    write(f.controller.runnerFile,{...read(f.controller.runnerFile),activeKernelTurns:1});
    f.controller.catalogAfter=0;
    await f.controller.tick();
    expect(Date.now()-Date.parse(read(f.controller.catalogFile).updatedAt)).toBeLessThan(5000);
    expect(read(f.controller.catalogFile).models).toEqual(catalog.models);
    expect(f.calls.length).toBe(calls);
  }finally{await f.cleanup();}
});

test('requests without Kimi auth, browser requests and unknown paths never reach a supplier', async () => {
  const f = await fixture();
  try {
    await f.controller.tick();
    for (const [suffix, headers, status] of [
      ['/chat/completions', {}, 401],
      ['/chat/completions', { Authorization: 'Bearer synthetic-kimi-key', Origin: 'https://example.invalid' }, 403],
      ['/unknown', { Authorization: 'Bearer synthetic-kimi-key' }, 404],
    ]) {
      const response = await fetch(f.controller.bridgeURL + suffix, { method: 'POST', headers, body: '{}' });
      expect(response.status).toBe(status); await response.text();
    }
    expect(f.requests).toHaveLength(0);
    expect(f.tools).toHaveLength(0);
  } finally { await f.cleanup(); }
});

test('waits for active Work tasks; pauses on outside config changes; explicit reconnect recovers', async () => {
  const f = await fixture();
  try {
    const runner = read(f.controller.runnerFile);
    write(f.controller.runnerFile, { ...runner, activeKernelTurns: 1 });
    await f.controller.tick();
    expect(f.controller.status.code).toBe('waiting_kimi_idle');
    expect(f.calls).toHaveLength(0);
    write(f.controller.runnerFile, runner);
    await f.controller.tick();
    expect(f.controller.status.code).toBe('connected');
    const doc = read(f.controller.configFile);
    doc.model.providers['daimon-kimi-code'].baseUrl = official;
    write(f.controller.configFile, doc);
    await f.controller.tick();
    expect(f.controller.status.code).toBe('kimi_config_changed');
    await f.controller.tick();
    expect(read(f.controller.configFile).model.providers['daimon-kimi-code'].baseUrl).toBe(official);
    write(f.controller.connectionFile, { ...f.connection, enabled: false });
    await f.controller.tick();
    write(f.controller.connectionFile, f.connection);
    await f.controller.tick();
    expect(f.controller.status.code).toBe('connected');
  } finally { await f.cleanup(); }
});

test('rejects remote gateway and control endpoints before changing Kimi', async () => {
  const f = await fixture();
  try {
    write(f.controller.connectionFile, { ...f.connection, gateway: { url: 'http://example.invalid/v1', key: 'synthetic' } });
    await f.controller.tick();
    expect(f.controller.status.code).toBe('invalid_gateway');
    expect(read(f.controller.configFile)).toEqual(f.doc);
    expect(() => controlEndpoint({ control: { endpoint: { url: 'ws://example.invalid/control', auth: { token: 'synthetic' } } } })).toThrow();
    expect(agent.id).toBe('kimi-desktop');
    expect(connect({ gateway: { v1: 'http://127.0.0.1:3425/v1', key: 'synthetic' } })['gateway.key']).toBe('synthetic');
  } finally { await f.cleanup(); }
});
