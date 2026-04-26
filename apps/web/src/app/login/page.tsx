'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { login, user, loaded } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (loaded && user) router.push('/dashboard'); }, [loaded, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try { await login(username.trim(), password); }
    catch (err: any) {
      setError(err.response?.data?.message ?? 'Erro ao autenticar.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex font-sans bg-cream">
      <div className="hidden lg:flex lg:w-1/2 bg-ink text-stone-100 p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-gold/5 blur-3xl"></div>
        <div className="flex items-center gap-2 relative z-10">
          <div className="w-8 h-8 rounded-sm bg-gold flex items-center justify-center">
            <span className="font-display text-ink text-lg font-bold">C</span>
          </div>
          <span className="font-display text-xl">ContBet</span>
        </div>
        <div className="relative z-10">
          <h1 className="font-display text-5xl leading-tight mb-6">
            Precisão fiscal<br />
            <span className="italic text-gold">para um mercado</span><br />
            que não dorme.
          </h1>
          <p className="text-stone-400 max-w-md leading-relaxed">
            Acesse a plataforma que organiza apurações, reportes regulatórios e o dia-a-dia contábil
            de operadoras de apostas brasileiras.
          </p>
        </div>
        <div className="text-xs text-stone-500 relative z-10">
          Plataforma em conformidade com a Lei 14.790/2023 e portarias da SPA/MF.
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center px-6 sm:px-16 py-12">
        <div className="lg:hidden flex items-center gap-2 mb-12">
          <div className="w-8 h-8 rounded-sm bg-ink flex items-center justify-center">
            <span className="font-display text-gold text-lg font-bold">C</span>
          </div>
          <span className="font-display text-xl">ContBet</span>
        </div>

        <div className="max-w-md w-full mx-auto lg:mx-0">
          <Link href="/" className="text-xs text-stone-500 hover:text-ink mb-8 flex items-center gap-1 transition">
            <ArrowLeft className="w-3 h-3" /> Voltar para o site
          </Link>

          <h2 className="font-display text-3xl mb-2">Bem-vindo de volta</h2>
          <p className="text-stone-600 text-sm mb-10">Acesse sua conta para continuar.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-xs uppercase tracking-wider text-stone-600 mb-2 block">Usuário</label>
              <input
                type="text" value={username} onChange={e => setUsername(e.target.value)}
                autoComplete="username" required
                className="w-full px-4 py-3 bg-white border border-stone-300 rounded-sm focus:outline-none focus:border-ink"
                placeholder="admin"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-stone-600 mb-2 block">Senha</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password" required
                  className="w-full px-4 py-3 bg-white border border-stone-300 rounded-sm focus:outline-none focus:border-ink pr-12"
                  placeholder="••••••"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-ink">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

            <div className="flex justify-between items-center text-sm">
              <a href="#" className="hover:text-gold underline-offset-4 hover:underline transition">
                Recuperar senha
              </a>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-ink text-stone-100 rounded-sm hover:bg-ink2 transition font-medium disabled:opacity-50">
              {loading ? 'Entrando...' : 'Entrar'}
            </button>

            <div className="text-xs text-stone-500 mt-6 p-3 bg-stone-100 border border-stone-200 rounded-sm">
              <strong>Acesso de demonstração:</strong> usuário <code className="bg-white px-1">admin</code> · senha <code className="bg-white px-1">123456</code>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
