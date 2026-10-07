'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export function SubmitButton({ children, pendingLabel = 'Wird gespeichert …', className = 'button button-primary', disabled = false }: { children: ReactNode; pendingLabel?: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={disabled || pending} aria-disabled={disabled || pending}>{pending ? pendingLabel : children}</button>;
}

export function ActionStatus({ error, message }: { error?: string | null; message?: string | null }) {
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (message) return <p className="alert alert-success" role="status">{message}</p>;
  return null;
}
