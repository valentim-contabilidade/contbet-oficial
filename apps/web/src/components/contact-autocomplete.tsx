'use client';

import { useEffect, useState, useRef } from 'react';
import { Search, Plus, X, User, Building2, Check, Tag } from 'lucide-react';
import { api } from '@/lib/api';
import type { Contact, ContactPersonType } from '@/lib/types';
import { formatDocument, formatPhone } from '@/lib/format';
import { Modal, Field, Input, Select, PrimaryButton, SecondaryButton } from '@/components/ui';

type ContactRole = 'supplier' | 'customer' | 'employee' | 'partner';

interface ContactAutocompleteProps {
  /** Empresa ativa (para filtrar contatos) */
  companyId: string;
  /** Tipo de pessoa permitido neste campo */
  role: ContactRole;
  /** ID do contato selecionado (controlado) */
  value: string | null;
  /** Disparado quando seleciona ou cria um novo contato */
  onChange: (contact: Contact | null) => void;
  /** Permite limpar a seleção e digitar nome livre como fallback */
  allowFreeText?: boolean;
  /** Texto inicial mostrado quando não há contato selecionado */
  fallbackText?: string;
  /** Disparado quando o usuário digita no modo "texto livre" */
  onFreeTextChange?: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const roleConfig: Record<ContactRole, { label: string; flag: keyof Contact; createMessage: string }> = {
  supplier: { label: 'fornecedor', flag: 'is_supplier', createMessage: 'Cadastrar como Fornecedor' },
  customer: { label: 'cliente', flag: 'is_customer', createMessage: 'Cadastrar como Cliente' },
  employee: { label: 'funcionário', flag: 'is_employee', createMessage: 'Cadastrar como Funcionário' },
  partner: { label: 'sócio', flag: 'is_partner', createMessage: 'Cadastrar como Sócio' },
};

function QuickContactForm({ defaultName, role, companyId, onCreated, onCancel }: {
  defaultName: string;
  role: ContactRole;
  companyId: string;
  onCreated: (contact: Contact) => void;
  onCancel: () => void;
}) {
  const config = roleConfig[role];
  const [data, setData] = useState({
    person_type: 'COMPANY' as ContactPersonType,
    name: defaultName,
    document: '',
    email: '',
    phone: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!data.name.trim() || data.name.length < 2) errs.name = 'Nome obrigatório';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = {
          person_type: data.person_type,
          name: data.name.trim(),
          company_id: companyId,
          [config.flag]: true,
        };
        if (data.document) payload.document = data.document.replace(/\D/g, '');
        if (data.email) payload.email = data.email;
        if (data.phone) payload.phone = data.phone.replace(/\D/g, '');

        const res = await api.post('/contacts', payload);
        onCreated(res.data);
      } catch (err: any) {
        setErrors({ form: err.response?.data?.message ?? 'Erro ao criar.' });
      } finally { setSubmitting(false); }
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 text-xs text-blue-800">
        💡 Cadastro rápido: você pode completar mais informações depois em <strong>Pessoas</strong>.
      </div>

      <Field label="Tipo de pessoa" required>
        <div className="grid grid-cols-2 gap-2">
          {(['COMPANY', 'INDIVIDUAL'] as ContactPersonType[]).map(t => (
            <button key={t} type="button" onClick={() => setData({ ...data, person_type: t })}
              className={`px-3 py-2 rounded-sm text-sm border transition ${data.person_type === t ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
              {t === 'COMPANY' ? <><Building2 className="w-3.5 h-3.5 inline mr-1.5" /> Pessoa Jurídica</> : <><User className="w-3.5 h-3.5 inline mr-1.5" /> Pessoa Física</>}
            </button>
          ))}
        </div>
      </Field>

      <Field label={data.person_type === 'COMPANY' ? 'Razão Social' : 'Nome completo'} required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} autoFocus />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={data.person_type === 'COMPANY' ? 'CNPJ' : 'CPF'}>
          <Input value={data.document} onChange={e => setData({ ...data, document: e.target.value })}
            placeholder={data.person_type === 'COMPANY' ? '00.000.000/0001-00' : '000.000.000-00'} />
        </Field>
        <Field label="Telefone">
          <Input value={data.phone} onChange={e => setData({ ...data, phone: e.target.value })} placeholder="(00) 00000-0000" />
        </Field>
      </div>

      <Field label="E-mail">
        <Input type="email" value={data.email} onChange={e => setData({ ...data, email: e.target.value })} />
      </Field>

      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>
          {submitting ? 'Criando...' : <><Plus className="w-4 h-4 inline mr-1.5" /> {config.createMessage}</>}
        </PrimaryButton>
      </div>
    </div>
  );
}

export function ContactAutocomplete({
  companyId, role, value, onChange,
  allowFreeText = true, fallbackText = '', onFreeTextChange,
  placeholder, disabled,
}: ContactAutocompleteProps) {
  const config = roleConfig[role];
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [freeText, setFreeText] = useState(fallbackText);
  const containerRef = useRef<HTMLDivElement>(null);

  // Busca contato ao receber value externo
  useEffect(() => {
    if (value && (!selectedContact || selectedContact.id !== value)) {
      api.get(`/contacts/${value}`)
        .then(r => setSelectedContact(r.data))
        .catch(() => setSelectedContact(null));
    }
    if (!value) {
      setSelectedContact(null);
    }
  }, [value, selectedContact]);

  // Busca quando digita
  useEffect(() => {
    if (!showDropdown || !companyId) return;
    if (query.length < 1 && !selectedContact) {
      // Carrega lista vazia/inicial só com flag
      const t = setTimeout(async () => {
        setLoading(true);
        try {
          const params: any = { company_id: companyId };
          params[`is_${role}`] = 'true';
          const res = await api.get('/contacts', { params });
          setResults(res.data.data.slice(0, 10));
        } finally { setLoading(false); }
      }, 100);
      return () => clearTimeout(t);
    }
    if (query.length === 0) return;

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params: any = { company_id: companyId };
        params[`is_${role}`] = 'true';
        // Tenta buscar por documento se for numérico
        const cleaned = query.replace(/\D/g, '');
        if (cleaned.length >= 3) params.document = cleaned;
        else params.name = query;

        const res = await api.get('/contacts', { params });
        setResults(res.data.data);
      } finally { setLoading(false); }
    }, 250);

    return () => clearTimeout(t);
  }, [query, showDropdown, companyId, role, selectedContact]);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (contact: Contact) => {
    setSelectedContact(contact);
    setQuery('');
    setShowDropdown(false);
    onChange(contact);
  };

  const handleClear = () => {
    setSelectedContact(null);
    setQuery('');
    setFreeText('');
    onChange(null);
    if (onFreeTextChange) onFreeTextChange('');
  };

  const handleCreated = (contact: Contact) => {
    setCreateOpen(false);
    handleSelect(contact);
  };

  // Modo "texto livre" — mostra quando explicitamente sem contato e tem texto digitado no fallback
  const isFreeTextMode = !selectedContact && allowFreeText && freeText.length > 0 && !showDropdown;

  return (
    <div ref={containerRef} className="relative">
      {/* Estado: contato selecionado */}
      {selectedContact && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-300 rounded-sm">
          {selectedContact.person_type === 'COMPANY' ? <Building2 className="w-4 h-4 text-green-700" /> : <User className="w-4 h-4 text-green-700" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-green-900 truncate">{selectedContact.name}</div>
            {selectedContact.document && (
              <div className="text-xs text-green-700">{formatDocument(selectedContact.document)}</div>
            )}
          </div>
          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-sm uppercase tracking-wider">cadastrado</span>
          {!disabled && (
            <button type="button" onClick={handleClear} className="text-stone-500 hover:text-red-600 p-1">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Estado: campo de busca */}
      {!selectedContact && (
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={query || (showDropdown ? '' : freeText)}
            onChange={e => {
              setQuery(e.target.value);
              if (allowFreeText && !showDropdown) {
                setFreeText(e.target.value);
                if (onFreeTextChange) onFreeTextChange(e.target.value);
              }
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder={placeholder || `Buscar ${config.label} cadastrado ou digite o nome`}
            disabled={disabled || !companyId}
            className="w-full pl-10 pr-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm"
          />
          {!companyId && (
            <div className="text-xs text-amber-700 mt-1">⚠️ Selecione uma empresa primeiro</div>
          )}
        </div>
      )}

      {/* Modo texto livre — alerta */}
      {isFreeTextMode && (
        <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
          <Tag className="w-3 h-3" /> Texto livre · não vinculado a um {config.label} cadastrado
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && companyId && !selectedContact && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-300 rounded-sm shadow-lg z-50 max-h-72 overflow-y-auto">
          {loading && <div className="px-3 py-3 text-sm text-stone-500 text-center">Buscando...</div>}

          {!loading && results.length === 0 && (
            <div className="px-3 py-4 text-sm text-stone-500 text-center">
              {query.length > 0 ? `Nenhum ${config.label} encontrado para "${query}"` : `Nenhum ${config.label} cadastrado ainda`}
            </div>
          )}

          {!loading && results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleSelect(c)}
              className="w-full text-left px-3 py-2.5 hover:bg-stone-50 border-b border-stone-100 last:border-b-0 flex items-center gap-3 transition"
            >
              {c.person_type === 'COMPANY' ? <Building2 className="w-4 h-4 text-stone-400 flex-shrink-0" /> : <User className="w-4 h-4 text-stone-400 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.name}</div>
                <div className="text-xs text-stone-500 flex items-center gap-2">
                  {c.document && <span className="font-mono">{formatDocument(c.document)}</span>}
                  {c.phone && <span>{formatPhone(c.phone)}</span>}
                </div>
              </div>
            </button>
          ))}

          {/* Sempre mostra botão "criar novo" no rodapé */}
          <button
            type="button"
            onClick={() => { setShowDropdown(false); setCreateOpen(true); }}
            className="w-full text-left px-3 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 text-sm font-medium flex items-center gap-2 border-t border-blue-200 transition"
          >
            <Plus className="w-4 h-4" />
            {query
              ? `Cadastrar "${query}" como ${config.label}`
              : `Cadastrar novo ${config.label}`}
          </button>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={`Novo ${config.label}`} size="md">
        <QuickContactForm
          defaultName={query}
          role={role}
          companyId={companyId}
          onCreated={handleCreated}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </div>
  );
}
