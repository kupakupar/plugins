export const agent = {
  id: 'kimi-desktop',
  name: 'Kimi',
  icon: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%228%22%20fill%3D%22%23151619%22%2F%3E%3Cpath%20d%3D%22M9%207h4v8l8-8h5L15%2017l11%208h-6l-7-6v6H9z%22%20fill%3D%22%23fff%22%2F%3E%3Cpath%20d%3D%22M22%2026h4%22%20stroke%3D%22%235fd4df%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%2F%3E%3C%2Fsvg%3E',
  config: '~/.config/magpie-kimi/connection.json',
  format: 'json',
  model: 'model',
  dir: '~/.config/magpie-kimi',
  ua: ['Desktop Kimi Work'],
  notice: '接入普通 Kimi 桌面版的 Work。请先打开 Kimi，插件会在本地 Agent 就绪后连接；Chat 不受影响。',
};

export function connect({ gateway }) {
  return {
    enabled: true,
    'gateway.url': gateway.v1,
    'gateway.key': gateway.key,
  };
}
