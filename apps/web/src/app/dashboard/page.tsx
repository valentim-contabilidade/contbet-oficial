'use client';

import { useEffect, useState } from 'react';
import { Building2, Users, Tag, Shield, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function OverviewPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ companies: 0, users: 0, brands: 0 });

  useEffect(() => {
    Promise.all([
      user?.profile === 'ADMIN' ? api.get('/companies').catch(() => ({ data: { total: 0 } })) : Promise.resolve({ data: { total: 0 } }),
      user?.profile !== 'OWNER' ? api.get('/users').catch(() => ({ data: { total: 0 } })) : Promise.resolve({ data: { total: 0 } }),
      api.get('/brands').catch(() => ({ data: { total: 0 } })),
    ]).then(([c, u, b]) => setStats({ companies: c.data.total, users: u.data.total, brands: b.data.total }));
  }, [user]);

  const cards = [
    { label: 'Empresas ativas', value: stats.companies, Icon: Building2 },
    { label: 'Usuários cadastrados', value: stats.users, Icon: Users },
    { label: 'Marcas operando', value: stats.brands, Icon: Tag },
    { label: 'Seu perfil', value: user?.profile, Icon: Shield, isText: true },
  ];

  return (
    <div>
      <div className="mb-10">
        <div className="text-xs uppercase tracking-widest text-stone-500 mb-2">Visão geral</div>
        <h1 className="font-display text-4xl">Olá, {user?.name?.split(' ')[0]}.</h1>
        <p className="text-stone-600 mt-2">Aqui está o resumo da sua operação no ContBet.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((s, i) => (
          <div key={i} className="bg-white border border-stone-200 p-6 rounded-sm">
            <s.Icon className="w-5 h-5 text-gold mb-4" strokeWidth={1.5} />
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">{s.label}</div>
            <div className={`font-display text-3xl ${s.isText ? 'text-xl' : ''}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-stone-200 p-8 rounded-sm">
        <h2 className="font-display text-2xl mb-2">Próximos passos</h2>
        <p className="text-stone-600 mb-6 text-sm">Módulos disponíveis no MVP. Demais módulos contábeis (GGR, IRRF, conciliação, COAF) entram nas próximas releases.</p>
        <div className="space-y-3 text-sm">
          {user?.profile === 'ADMIN' && <div className="flex gap-3"><Check className="w-4 h-4 text-gold mt-0.5" /> Cadastre empresas (operadoras) que serão gerenciadas pelo escritório</div>}
          {(user?.profile === 'ADMIN' || user?.profile === 'MANAGER') && <div className="flex gap-3"><Check className="w-4 h-4 text-gold mt-0.5" /> Crie usuários e atribua perfis (Manager/Owner)</div>}
          <div className="flex gap-3"><Check className="w-4 h-4 text-gold mt-0.5" /> Gerencie as marcas vinculadas a cada operadora</div>
        </div>
      </div>
    </div>
  );
}
