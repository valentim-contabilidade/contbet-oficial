'use client';

import { ReactNode } from 'react';
import { Search, ChevronLeft, ChevronRight, AlertTriangle, X, Plus } from 'lucide-react';
import { profileLabel } from '@/lib/types';
import { paymentStatusLabels, paymentStatusColors } from '@/lib/format';

export const PageHeader = ({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 pb-6 border-b border-stone-200">
    <div>
      <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">{subtitle}</div>
      <h1 className="font-display text-4xl">{title}</h1>
    </div>
    {action}
  </div>
);

interface Filter { key: string; label: string; placeholder?: string; type?: 'text' | 'select'; options?: { value: string; label: string }[]; }

export const FilterBar = ({ filters, values, onChange }: { filters: Filter[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) => (
  <div className="flex flex-wrap gap-3 mb-6 bg-white border border-stone-200 p-4 rounded-sm">
    {filters.map(f => (
      <div key={f.key} className="flex-1 min-w-[180px]">
        <label className="text-xs text-stone-500 uppercase tracking-wider block mb-1">{f.label}</label>
        {f.type === 'select' ? (
          <select value={values[f.key] || ''} onChange={e => onChange({ ...values, [f.key]: e.target.value })}
            className="w-full px-3 py-2 bg-stone-50 border border-stone-200 text-sm focus:outline-none focus:border-ink rounded-sm">
            <option value="">Todos</option>
            {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input value={values[f.key] || ''} onChange={e => onChange({ ...values, [f.key]: e.target.value })}
              placeholder={f.placeholder || 'Buscar...'}
              className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 text-sm focus:outline-none focus:border-ink rounded-sm" />
          </div>
        )}
      </div>
    ))}
  </div>
);

export const Pagination = ({ page, setPage, total, perPage = 50 }: { page: number; setPage: (p: number) => void; total: number; perPage?: number }) => {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage) return null;
  return (
    <div className="flex items-center justify-between mt-6 text-sm">
      <span className="text-stone-500">Mostrando {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} de {total}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
          className="p-2 border border-stone-300 rounded-sm hover:bg-stone-100 disabled:opacity-30">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-3">Página {page} de {totalPages}</span>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          className="p-2 border border-stone-300 rounded-sm hover:bg-stone-100 disabled:opacity-30">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const Modal = ({ open, onClose, title, children, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; size?: 'md' | 'lg' }) => {
  if (!open) return null;
  const w = size === 'lg' ? 'max-w-3xl' : 'max-w-xl';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className={`bg-white rounded-sm ${w} w-full my-8 border-t-4 border-gold`}>
        <div className="flex items-center justify-between p-6 border-b border-stone-200">
          <h3 className="font-display text-2xl">{title}</h3>
          <button onClick={onClose} className="text-stone-500 hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

export const ConfirmDeleteModal = ({ open, onClose, onConfirm, entityName, entityLabel }: { open: boolean; onClose: () => void; onConfirm: () => void; entityName?: string; entityLabel: string }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-sm max-w-md w-full p-8 border-t-4 border-gold">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <h3 className="font-display text-2xl">Confirmar exclusão</h3>
        </div>
        <p className="text-stone-600 mb-6 text-sm leading-relaxed">
          Você está prestes a remover {entityLabel} <strong>{entityName}</strong>.
          Esta ação realiza uma <em>deleção lógica</em> — o registro será marcado como removido,
          mas pode ser recuperado por um administrador.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2 text-stone-700 hover:bg-stone-100 rounded-sm transition text-sm">Cancelar</button>
          <button onClick={onConfirm} className="px-5 py-2 bg-red-600 text-white hover:bg-red-700 rounded-sm transition text-sm">Confirmar exclusão</button>
        </div>
      </div>
    </div>
  );
};

export const Field = ({ label, error, children, required }: { label: ReactNode; error?: string; children: ReactNode; required?: boolean }) => (
  <div>
    <label className="text-xs uppercase tracking-wider text-stone-600 mb-2 block">
      {label}{required && <span className="text-red-500 ml-1">*</span>}
    </label>
    {children}
    {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
  </div>
);

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm ${props.className || ''}`} />
);

export const Select = ({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) => (
  <select {...props} className={`w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm ${props.className || ''}`}>{children}</select>
);

export const PrimaryButton = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} className={`px-4 py-2 bg-ink text-stone-100 rounded-sm hover:bg-ink2 transition text-sm flex items-center gap-2 ${props.className || ''}`}>{children}</button>
);

export const SecondaryButton = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} className={`px-4 py-2 border border-stone-300 rounded-sm hover:bg-stone-100 transition text-sm ${props.className || ''}`}>{children}</button>
);

export const ProfileBadge = ({ profile }: { profile: string }) => {
  const colors: Record<string, string> = {
    ADMIN: 'bg-ink text-gold',
    MANAGER: 'bg-gold/20 text-amber-800 border border-gold/40',
    OWNER: 'bg-stone-100 text-stone-700 border border-stone-300',
  };
  return <span className={`text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${colors[profile]}`}>{profileLabel(profile)}</span>;
};

export const NewButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <PrimaryButton onClick={onClick}><Plus className="w-4 h-4" />{label}</PrimaryButton>
);

export const StatusBadge = ({ status }: { status: string }) => {
  const label = paymentStatusLabels[status] ?? status;
  const cls = paymentStatusColors[status] ?? 'bg-stone-100 text-stone-700 border border-stone-300';
  return <span className={`inline-block text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${cls}`}>{label}</span>;
};
