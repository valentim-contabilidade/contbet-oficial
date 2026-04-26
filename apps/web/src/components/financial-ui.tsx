'use client';

import { useState, useEffect } from 'react';
import { formatCurrencyInput, parseCurrencyInput, paymentStatusLabels, paymentStatusColors } from '@/lib/format';

interface CurrencyInputProps {
  value: number; // centavos
  onChange: (cents: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Input de moeda BRL: o usuário digita números e o componente formata automaticamente.
 * Internamente trabalha com centavos.
 */
export function CurrencyInput({ value, onChange, placeholder = '0,00', disabled, className }: CurrencyInputProps) {
  const [display, setDisplay] = useState(() => value ? formatCurrencyInput(String(value)) : '');

  useEffect(() => {
    setDisplay(value ? formatCurrencyInput(String(value)) : '');
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatCurrencyInput(raw);
    setDisplay(formatted);
    onChange(parseCurrencyInput(formatted));
  };

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 text-sm pointer-events-none">R$</span>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full pl-10 pr-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm text-right font-mono ${className || ''}`}
      />
    </div>
  );
}

/** Badge de status de pagamento */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${paymentStatusColors[status] || 'bg-stone-100 text-stone-600'}`}>
      {paymentStatusLabels[status] || status}
    </span>
  );
}

/** Valor monetário colorido (verde=positivo, vermelho=negativo) */
export function MoneyText({ cents, className }: { cents: string | number; className?: string }) {
  const value = Number(cents);
  const isNeg = value < 0;
  const formatted = (Math.abs(value) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return (
    <span className={`font-mono ${isNeg ? 'text-red-700' : 'text-ink'} ${className || ''}`}>
      {isNeg && '-'}{formatted}
    </span>
  );
}
