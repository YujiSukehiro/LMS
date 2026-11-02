'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyJoinLinkButton({ joinCode }: { joinCode: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    const link = `${window.location.origin}/join/${encodeURIComponent(joinCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this join link:', link);
    }
  }

  return (
    <button type="button" className="pulse-btn pulse-btn-ghost px-2 py-1 text-xs" onClick={copy}>
      {copied ? <Check className="h-3.5 w-3.5 text-pulse-emerald" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy join link'}
    </button>
  );
}
