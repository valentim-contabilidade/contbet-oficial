'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Building2, Users, Tag, X, Menu, CircleUser, LogOut, Wallet, Landmark, ArrowDownCircle, ArrowUpCircle, BookOpen, FolderTree, Receipt, ChevronDown, ChevronRight, UserCheck, ScanLine, Calculator, Gauge, Settings, Scale, FileText, Key, FileBarChart2, TrendingUp, Layers, Library, BookOpenCheck, Banknote } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { profileLabel } from '@/lib/types';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loaded, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  type MenuKey = 'cadastros' | 'financial' | 'ggr' | 'tax' | 'fiscal' | 'accounting' | 'reports' | null;

  const cadastrosRoutes = ['/dashboard/companies', '/dashboard/users', '/dashboard/brands', '/dashboard/contacts', '/dashboard/financial/bank-accounts', '/dashboard/financial/banks', '/dashboard/bank-integrations'];
  const initialMenu: MenuKey =
    cadastrosRoutes.some(r => pathname === r || pathname.startsWith(r + '/')) ? 'cadastros' :
    pathname.startsWith('/dashboard/accounting') ? 'accounting' :
    pathname.startsWith('/dashboard/financial') ? 'financial' :
    pathname.startsWith('/dashboard/ggr') ? 'ggr' :
    pathname.startsWith('/dashboard/tax') ? 'tax' :
    pathname.startsWith('/dashboard/fiscal') ? 'fiscal' :
    pathname.startsWith('/dashboard/reports') ? 'reports' : null;
  const [openMenu, setOpenMenu] = useState<MenuKey>(initialMenu);
  const toggleMenu = (key: Exclude<MenuKey, null>) => setOpenMenu(prev => prev === key ? null : key);

  const cadastrosOpen = openMenu === 'cadastros';
  const financialOpen = openMenu === 'financial';
  const ggrOpen = openMenu === 'ggr';
  const taxOpen = openMenu === 'tax';
  const fiscalOpen = openMenu === 'fiscal';
  const accountingOpen = openMenu === 'accounting';
  const reportsOpen = openMenu === 'reports';

  useEffect(() => {
    if (loaded && !user) router.replace('/login');
  }, [loaded, user, router]);

  if (!loaded || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-cream"><div className="text-stone-500">Carregando...</div></div>;
  }

  const canManageFinancial = user.profile === 'ADMIN' || user.profile === 'MANAGER';

  const items = [
    { href: '/dashboard', label: 'Visão Geral', Icon: BarChart3, show: true },
  ].filter(i => i.show);

  const cadastrosItems = [
    { href: '/dashboard/companies', label: 'Empresas', Icon: Building2, show: user.profile === 'ADMIN' },
    { href: '/dashboard/users', label: 'Usuários', Icon: Users, show: user.profile === 'ADMIN' || user.profile === 'MANAGER' },
    { href: '/dashboard/brands', label: 'Marcas', Icon: Tag, show: user.profile === 'ADMIN' },
    { href: '/dashboard/contacts', label: 'Pessoas', Icon: UserCheck, show: user.profile === 'ADMIN' || user.profile === 'MANAGER' },
    { href: '/dashboard/financial/bank-accounts', label: 'Contas Bancárias', Icon: Landmark, show: canManageFinancial },
    { href: '/dashboard/financial/banks', label: 'Bancos', Icon: Building2, show: canManageFinancial },
    { href: '/dashboard/bank-integrations', label: 'Integrações bancárias', Icon: Banknote, show: canManageFinancial },
  ].filter(i => i.show);

  const financialItems = [
    { href: '/dashboard/financial', label: 'Visão Financeira', Icon: Wallet },
    { href: '/dashboard/financial/accounts-payable', label: 'Contas a Pagar', Icon: ArrowUpCircle },
    { href: '/dashboard/financial/accounts-receivable', label: 'Recebíveis', Icon: ArrowDownCircle },
    { href: '/dashboard/financial/transactions', label: 'Lançamentos', Icon: Receipt },
    { href: '/dashboard/financial/reconciliation', label: 'Conciliação', Icon: ScanLine },
    { href: '/dashboard/financial/natures', label: 'Naturezas (DRE)', Icon: Layers },
    { href: '/dashboard/financial/categories', label: 'Categorias', Icon: FolderTree },
    { href: '/dashboard/financial/chart-of-accounts', label: 'Plano de Contas', Icon: BookOpen },
  ];

  const ggrItems = [
    { href: '/dashboard/ggr', label: 'Painel GGR', Icon: Gauge },
    { href: '/dashboard/ggr/import', label: 'Importar dados', Icon: ArrowUpCircle },
    { href: '/dashboard/ggr/daily', label: 'Registros diários', Icon: BarChart3 },
    { href: '/dashboard/ggr/apurations', label: 'Apurações mensais', Icon: Calculator },
  ];

  const taxItems = [
    { href: '/dashboard/tax/apurations', label: 'Apurações tributárias', Icon: Calculator, show: true },
    { href: '/dashboard/tax/config', label: 'Configuração tributária', Icon: Settings, show: user.profile === 'ADMIN' },
  ].filter(i => i.show);

  const fiscalItems = [
    { href: '/dashboard/fiscal/documents', label: 'Documentos fiscais', Icon: FileText },
    { href: '/dashboard/fiscal/certificates', label: 'Certificados A1', Icon: Key },
    { href: '/dashboard/fiscal/provider', label: 'Configurar provedor', Icon: Settings },
  ];

  const reportsItems = [
    { href: '/dashboard/reports/dre', label: 'DRE Gerencial', Icon: TrendingUp },
  ];

  const accountingItems = [
    { href: '/dashboard/accounting/journal', label: 'Lançamentos contábeis', Icon: BookOpenCheck, show: user.profile === 'ADMIN' },
    { href: '/dashboard/accounting/income-statement', label: 'DRE Contábil', Icon: TrendingUp, show: true },
    { href: '/dashboard/accounting/trial-balance', label: 'Balancete', Icon: Scale, show: true },
    { href: '/dashboard/accounting/balance-sheet', label: 'Balanço Patrimonial', Icon: Library, show: true },
  ].filter(i => i.show);

  return (
    <div className="min-h-screen bg-cream font-sans flex">
      <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-40 w-64 bg-ink text-stone-100 transition-transform duration-200 flex flex-col`}>
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-sm bg-gold flex items-center justify-center">
              <span className="font-display text-ink text-lg font-bold">C</span>
            </div>
            <span className="font-display text-xl">ContBet</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-stone-300"><X className="w-5 h-5" /></button>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {items.map(item => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-sm text-sm transition ${active ? 'bg-gold text-ink font-medium' : 'text-stone-300 hover:bg-white/5'}`}>
                <item.Icon className="w-4 h-4" strokeWidth={1.5} />
                {item.label}
              </Link>
            );
          })}

          {cadastrosItems.length > 0 && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <button onClick={() => toggleMenu('cadastros')}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-sm text-sm text-stone-300 hover:bg-white/5">
                <span className="flex items-center gap-3"><FolderTree className="w-4 h-4" strokeWidth={1.5} />Cadastros</span>
                {cadastrosOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {cadastrosOpen && (
                <div className="mt-1 ml-2 space-y-0.5 border-l border-white/10 pl-2">
                  {cadastrosItems.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs transition ${active ? 'bg-gold/15 text-gold font-medium' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'}`}>
                        <item.Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {canManageFinancial && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <button onClick={() => toggleMenu('financial')}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-sm text-sm text-stone-300 hover:bg-white/5">
                <span className="flex items-center gap-3"><Wallet className="w-4 h-4" strokeWidth={1.5} />Financeiro</span>
                {financialOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {financialOpen && (
                <div className="mt-1 ml-2 space-y-0.5 border-l border-white/10 pl-2">
                  {financialItems.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs transition ${active ? 'bg-gold/15 text-gold font-medium' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'}`}>
                        <item.Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {canManageFinancial && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <button onClick={() => toggleMenu('ggr')}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-sm text-sm text-stone-300 hover:bg-white/5">
                <span className="flex items-center gap-3"><Gauge className="w-4 h-4" strokeWidth={1.5} />GGR & Impostos</span>
                {ggrOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {ggrOpen && (
                <div className="mt-1 ml-2 space-y-0.5 border-l border-white/10 pl-2">
                  {ggrItems.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs transition ${active ? 'bg-gold/15 text-gold font-medium' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'}`}>
                        <item.Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {canManageFinancial && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <button onClick={() => toggleMenu('tax')}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-sm text-sm text-stone-300 hover:bg-white/5">
                <span className="flex items-center gap-3"><Scale className="w-4 h-4" strokeWidth={1.5} />Tributário</span>
                {taxOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {taxOpen && (
                <div className="mt-1 ml-2 space-y-0.5 border-l border-white/10 pl-2">
                  {taxItems.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs transition ${active ? 'bg-gold/15 text-gold font-medium' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'}`}>
                        <item.Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {canManageFinancial && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <button onClick={() => toggleMenu('fiscal')}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-sm text-sm text-stone-300 hover:bg-white/5">
                <span className="flex items-center gap-3"><FileText className="w-4 h-4" strokeWidth={1.5} />Notas Fiscais</span>
                {fiscalOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {fiscalOpen && (
                <div className="mt-1 ml-2 space-y-0.5 border-l border-white/10 pl-2">
                  {fiscalItems.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs transition ${active ? 'bg-gold/15 text-gold font-medium' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'}`}>
                        <item.Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {accountingItems.length > 0 && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <button onClick={() => toggleMenu('accounting')}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-sm text-sm text-stone-300 hover:bg-white/5">
                <span className="flex items-center gap-3"><Library className="w-4 h-4" strokeWidth={1.5} />Contabilidade</span>
                {accountingOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {accountingOpen && (
                <div className="mt-1 ml-2 space-y-0.5 border-l border-white/10 pl-2">
                  {accountingItems.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs transition ${active ? 'bg-gold/15 text-gold font-medium' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'}`}>
                        <item.Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {canManageFinancial && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <button onClick={() => toggleMenu('reports')}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-sm text-sm text-stone-300 hover:bg-white/5">
                <span className="flex items-center gap-3"><FileBarChart2 className="w-4 h-4" strokeWidth={1.5} />Relatórios</span>
                {reportsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {reportsOpen && (
                <div className="mt-1 ml-2 space-y-0.5 border-l border-white/10 pl-2">
                  {reportsItems.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs transition ${active ? 'bg-gold/15 text-gold font-medium' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'}`}>
                        <item.Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-white/10 text-xs text-stone-500">
          <div className="mb-1">Perfil: <span className="text-gold">{profileLabel(user.profile)}</span></div>
          <div>v1.0 · ContBet</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden"><Menu className="w-5 h-5" /></button>
          <div className="hidden lg:block text-xs text-stone-500 uppercase tracking-widest">Painel administrativo</div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <CircleUser className="w-7 h-7" strokeWidth={1.5} />
              <div className="hidden sm:block">
                <div className="text-sm font-medium">{user.name}</div>
                <div className="text-xs text-stone-500">{user.email}</div>
              </div>
            </div>
            <button onClick={logout} className="p-2 text-stone-600 hover:text-ink hover:bg-stone-100 rounded-sm transition" title="Sair">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>

      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}
