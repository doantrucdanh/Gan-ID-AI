
import React from 'react';

interface Props {
  status: 'valid' | 'warning' | 'error';
  label: string;
}

export const StatusBadge: React.FC<Props> = ({ status, label }) => {
  const styles = {
    valid: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-1 ring-emerald-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-200 ring-1 ring-amber-100',
    error: 'bg-rose-50 text-rose-700 border-rose-200 ring-1 ring-rose-100',
  };

  const emojis = {
    valid: '✅',
    warning: '⚠️',
    error: '❌',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border transition-all ${styles[status]}`}>
      <span>{emojis[status]}</span>
      {label}
    </span>
  );
};
