export type AppView = 'customer' | 'pharmacist' | 'split' | 'admin';

export function resolveAppView(pathname: string, search = ''): AppView {
  if (pathname === '/duoc-si') return 'pharmacist';
  if (pathname === '/admin') return 'admin';
  if (new URLSearchParams(search).get('view') === 'split') return 'split';
  return 'customer';
}
