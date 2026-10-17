import {test, expect} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_internal as I} from './index.mjs';

const session = {uid: 'synthetic-account', workToken: 'synthetic-work-token', webToken: 'synthetic-web-token'};
const auth = {source: 'kimi-work-desktop', uid: session.uid};
const models = {data: [{id: 'k3-agent', display_name: 'K3', context_length: 1000000,
  supports_image_in: true, supports_reasoning: true, reasoningEffortOptions: [{effort: 'REASONING_EFFORT_LOW'}, {effort: 'REASONING_EFFORT_MAX'}]}]};

test('sign-in saves an account reference and dynamic models/usage retain Work accounting', async () => {
  const calls = [];
  const p = I.createPlugin({readSession: () => session, fetchImpl: async (url, init) => {
    calls.push({url, init});
    return Response.json(url.endsWith('/models') ? models : {subscriptionBalance: {amountUsedRatio: 0.42}, ratelimitCode5h: {ratio: 1}});
  }});
  const result = await (await p.auth.methods[0].authorize()).callback();
  expect(result).toMatchObject({type: 'success', source: auth.source, uid: auth.uid});
  expect(JSON.stringify(result)).not.toContain(session.workToken);
  const catalog = await p.provider.models({models: {}}, {auth});
  expect(catalog['k3-agent'].limit.context).toBe(262144);
  expect(Object.keys(catalog['k3-agent'].variants)).toEqual(['low', 'max']);
  expect((await p.auth.usage(async () => auth)).windows).toEqual([{name: '会员共享额度', used: 42}]);
  expect(calls.at(-1).init.headers.Authorization).toBe('Bearer ' + session.webToken);
});

test('requests preserve prompts, tools, streaming and cancellation while rotating only Work credentials', async () => {
  let live = {...session}; const calls = [];
  const p = I.createPlugin({readSession: () => live, fetchImpl: async (url, init) => {
    calls.push({url, init}); return new Response('data: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream'}});
  }});
  const loader = await p.auth.loader(async () => auth);
  const body = JSON.stringify({model: 'k3-agent', messages: [{role: 'system', content: 'synthetic shared instruction'}],
    tools: [{type: 'function', function: {name: 'Read', parameters: {type: 'object'}}}], stream: true});
  const signal = new AbortController().signal;
  const request = new Request(I.BASE + '/chat/completions', {method: 'POST', body, signal,
    headers: {Authorization: 'Bearer synthetic-code-token', Cookie: 'synthetic-cookie'}});
  expect(await (await loader.fetch(request)).text()).toBe('data: [DONE]\n\n');
  expect(await new Response(calls[0].init.body).text()).toBe(body);
  expect(calls[0].init.headers.get('authorization')).toBe('Bearer ' + session.workToken);
  expect(calls[0].init.headers.get('cookie')).toBeNull();
  expect(calls[0].init.signal.aborted).toBe(false);
  live.workToken = 'synthetic-rotated';
  await loader.fetch(I.BASE + '/chat/completions', {method: 'POST', body, signal});
  expect(calls[1].init.headers.get('authorization')).toBe('Bearer synthetic-rotated');
  live.uid = 'different-account';
  await expect(loader.fetch(I.BASE + '/chat/completions', {method: 'POST', body})).rejects.toMatchObject({signIn: 'expired'});
  expect(calls).toHaveLength(2);
});

test('fixed upstream errors distinguish login, limits and service failures without raw response leakage', async () => {
  for (const status of [401, 429, 502]) {
    const p = I.createPlugin({readSession: () => session, fetchImpl: async () => new Response('synthetic-private-upstream-detail',
      {status, headers: {'Retry-After': '30'}})});
    const loader = await p.auth.loader(async () => auth);
    const request = () => loader.fetch(I.BASE + '/chat/completions', {method: 'POST', body: '{}'});
    if (status === 401) await expect(request()).rejects.toMatchObject({signIn: 'expired', code: 'kimi_work_login_expired'});
    else {
      const response = await request();
      expect(response.status).toBe(status);
      expect(response.headers.get('retry-after')).toBe('30');
      const text = await response.text();
      expect(text).not.toContain('synthetic-private');
      expect(JSON.parse(text).error.code).toBe(status === 429 ? 'kimi_work_rate_limited' : 'kimi_work_upstream_unavailable');
    }
  }
  const p = I.createPlugin({readSession: () => session, fetchImpl: async () => {throw Error('synthetic-secret-url');}});
  const loader = await p.auth.loader(async () => auth);
  await expect(loader.fetch(I.BASE + '/chat/completions', {method: 'POST'})).rejects.toMatchObject({code: 'kimi_work_connection_failed'});
  await expect(loader.fetch('https://example.invalid/chat/completions', {method: 'POST'})).rejects.toThrow('仅接受官方');
});

test('desktop import is read-only and never substitutes a Code endpoint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-provider-fixture-'));
  const file = path.join(dir, 'config.json');
  const doc = {credentials: {kimiCode: {apiKey: session.workToken, baseUrl: I.BASE},
    kimiWeb: {accessToken: session.webToken, userId: 'synthetic-user'}}};
  try {
    fs.writeFileSync(file, JSON.stringify(doc)); const before = fs.readFileSync(file);
    expect(I.readDesktop(file).workToken).toBe(session.workToken);
    expect(fs.readFileSync(file)).toEqual(before);
    doc.credentials.kimiCode.baseUrl = 'https://api.kimi.com/coding/v1'; fs.writeFileSync(file, JSON.stringify(doc));
    expect(() => I.readDesktop(file)).toThrow();
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
