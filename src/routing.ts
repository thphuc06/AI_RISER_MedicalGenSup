export type AppView = 'customer' | 'pharmacist' | 'split';

export function resolveAppView(pathname: string, search = ''): AppView {
  if (pathname === '/duoc-si') return 'pharmacist';
  if (new URLSearchParams(search).get('view') === 'split') return 'split';
  return 'customer';
}
