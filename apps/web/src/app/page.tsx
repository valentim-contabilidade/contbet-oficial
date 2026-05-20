'use client';

import Link from 'next/link';
import { Lato } from 'next/font/google';
import { TrendingUp, FileText, Shield } from 'lucide-react';

const lato = Lato({
  subsets: ['latin'],
  weight: ['300', '400', '700', '900'],
  display: 'swap',
});

export default function LandingPage() {
  return (
    <div className={`${lato.className} min-h-screen bg-ink text-stone-100`}>
      <nav className="border-b border-white/10 backdrop-blur-sm sticky top-0 z-50 bg-ink/80">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-sm bg-gold flex items-center justify-center">
              <span className="text-ink text-lg font-bold">C</span>
            </div>
            <span className="text-xl tracking-tight font-semibold">ContBet</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-stone-300">
            <a href="#solucoes" className="hover:text-gold transition">Soluções</a>
            <a href="#regulacao" className="hover:text-gold transition">Regulação</a>
            <a href="#contato" className="hover:text-gold transition">Contato</a>
          </div>
          <Link
            href="/login"
            className="px-5 py-2 bg-gold text-ink font-medium rounded-sm hover:bg-gold2 transition text-sm"
          >
            Entrar →
          </Link>
        </div>
      </nav>

      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="grid md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-7">
            <div className="inline-block px-3 py-1 border border-gold/30 text-gold text-xs uppercase tracking-widest mb-8 rounded-sm">
              Lei 14.790/2023 · SPA/MF · Compliance
            </div>
            <h1 className="text-5xl md:text-7xl leading-[0.95] tracking-tight mb-8 font-semibold">
              Contabilidade<br />
              <span className="italic text-gold">especializada</span><br />
              para o mercado<br />
              de apostas.
            </h1>
            <p className="text-stone-400 text-lg max-w-xl mb-10 leading-relaxed">
              ContBet é a plataforma que organiza sua operação contábil, fiscal e regulatória.
              Construída para operadoras que entendem que precisão não é opcional.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/login" className="px-7 py-3.5 bg-gold text-ink font-medium rounded-sm hover:bg-gold2 transition">
                Acessar plataforma
              </Link>
              <button className="px-7 py-3.5 border border-white/20 text-stone-200 rounded-sm hover:bg-white/5 transition">
                Falar com especialista
              </button>
            </div>
          </div>
          <div className="md:col-span-5 hidden md:block">
            <div className="aspect-square border border-gold/20 p-8 relative">
              <div className="absolute -top-px -left-px w-12 h-12 border-t-2 border-l-2 border-gold"></div>
              <div className="absolute -bottom-px -right-px w-12 h-12 border-b-2 border-r-2 border-gold"></div>
              <div className="grid grid-cols-2 gap-4 h-full">
                {[
                  { label: 'GGR', val: 'R$ 2.4M', sub: '+12% mês' },
                  { label: 'Tributos', val: '12%', sub: 'sobre GGR' },
                  { label: 'PIS/COFINS', val: '3,65%', sub: 'cumulativo' },
                  { label: 'Compliance', val: '100%', sub: 'em dia' },
                ].map((m, i) => (
                  <div key={i} className="border-b border-r border-white/10 p-4 flex flex-col justify-between">
                    <span className="text-xs uppercase tracking-wider text-stone-500">{m.label}</span>
                    <div>
                      <div className="text-2xl text-gold font-semibold">{m.val}</div>
                      <div className="text-xs text-stone-400 mt-1">{m.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="solucoes" className="border-t border-white/10 max-w-7xl mx-auto px-6 py-24">
        <div className="text-xs uppercase tracking-widest text-gold mb-3">01 — Soluções</div>
        <h2 className="text-4xl md:text-5xl mb-16 max-w-3xl font-semibold">
          O que cada operação precisa, no padrão que a regulamentação exige.
        </h2>
        <div className="grid md:grid-cols-3 gap-px bg-white/10">
          {[
            { Icon: TrendingUp, title: 'Apuração de GGR', desc: 'Cálculo automatizado da contribuição de 12% e distribuição da arrecadação conforme Lei 14.790.' },
            { Icon: FileText, title: 'Obrigações Acessórias', desc: 'Reportes à SPA, COAF e Receita Federal organizados em uma agenda fiscal unificada.' },
            { Icon: Shield, title: 'PLD/FT e KYC', desc: 'Monitoramento de operações suspeitas e trilhas de auditoria para órgãos reguladores.' },
          ].map((s, i) => (
            <div key={i} className="bg-ink p-10 hover:bg-ink2 transition group">
              <s.Icon className="w-7 h-7 text-gold mb-6" strokeWidth={1.5} />
              <h3 className="text-xl mb-3 font-semibold">{s.title}</h3>
              <p className="text-stone-400 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/10 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row justify-between gap-6 text-sm text-stone-500">
          <div>© 2026 ContBet. Todos os direitos reservados.</div>
          <div className="flex gap-8">
            <span>contato@contbet.com.br</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
