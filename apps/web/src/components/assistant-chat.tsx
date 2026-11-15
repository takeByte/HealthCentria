import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Bot, LoaderCircle, RotateCcw, Send, Sparkles } from 'lucide-react';
import { InlineNotice, panel } from './app-ui';
import { ApiError, assistantChat, assistantStatus, type AssistantMessage } from '../lib/api';
import { cn } from '../lib/utils';

const MAX_LENGTH = 1500;

const SUGGESTIONS: Record<'patient' | 'staff', string[]> = {
  patient: [
    'What services does the health center offer?',
    'How do I book an appointment?',
    'Until when can I cancel an appointment?',
    'Where can I see my visit records?',
  ],
  staff: [
    'How do I complete a visit?',
    'How do I register an emergency walk-in?',
    'How do I export a report to Google Sheets?',
    'Why can a staff member not see the Patients tab?',
  ],
};

/** What the assistant can and cannot help with, shown at the top of the chat. */
const SCOPE: Record<'patient' | 'staff', { can: string[]; cannot: string[] }> = {
  patient: {
    can: [
      'Health center services and their schedules',
      'Announcements and health advisories',
      'How to book, cancel and view appointments (including the cancellation time limit)',
      'Where to find your records, profile and notifications in the app',
      'Login and password help',
    ],
    cannot: [
      'Medical advice, diagnosis or medicines',
      'Your personal records or appointment details',
      'Anything unrelated to the health center or this app',
    ],
  },
  staff: {
    can: [
      'How to use the system: appointments, emergency walk-ins, patients, services, announcements',
      'Reports, exports, the activity log, User Management, backups and settings',
      'What permissions and the superadmin PIN do',
      'Health center services, schedules and announcements',
    ],
    cannot: [
      'Looking up patient records or clinic statistics (use the Patients or Reports page)',
      'Medical advice',
      'Anything unrelated to the health center or this system',
    ],
  },
};

/** **bold** inside a line, without ever injecting HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Small safe renderer for the model's plain text: paragraphs, bullet and numbered lists, bold. */
function ReplyText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const isList = lines.length > 0 && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          const ordered = /^\s*\d+[.)]/.test(lines[0]);
          const Tag = ordered ? 'ol' : 'ul';
          return (
            <Tag key={bi} className={cn('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Chat page for the AI assistant. The conversation lives only in this component:
 * nothing is saved on the server or in the browser, and it disappears when the
 * page is closed or "New chat" is pressed.
 */
export function AssistantChat({ audience }: { audience: 'patient' | 'staff' }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'off' | 'not-configured'>('loading');
  const [scopeOpen, setScopeOpen] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    assistantStatus()
      .then((s) => {
        if (cancelled) return;
        setAvailability(!s.enabled ? 'off' : !s.configured ? 'not-configured' : 'ready');
      })
      .catch(() => {
        if (!cancelled) setAvailability('ready'); // let the first message report any real problem
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    const next: AssistantMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setError(null);
    setScopeOpen(false);
    setSending(true);
    try {
      const reply = await assistantChat(next);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the assistant. Try again.');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  function newChat() {
    setMessages([]);
    setError(null);
    setInput('');
    inputRef.current?.focus();
  }

  const unavailable = availability === 'off' || availability === 'not-configured';

  return (
    <section className={cn(panel, 'flex h-[calc(100vh-13rem)] min-h-[420px] flex-col p-0')} aria-label="AI assistant">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#1f55a8]/10 text-[#1f55a8]">
            <Sparkles size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
              HealthCentria Assistant
            </h2>
            <p className="truncate text-[12px] text-slate-500">
              Clinic information and help using the system. Chats are not saved.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={newChat}
          disabled={messages.length === 0 || sending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40"
        >
          <RotateCcw size={14} aria-hidden /> New chat
        </button>
      </div>

      <details
        open={scopeOpen}
        onToggle={(e) => setScopeOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="border-b border-slate-200/70 bg-[#eaf3fc]/40 px-4 py-2.5 sm:px-5"
      >
        <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-[#1a448a]">
          What I can answer (and what I can&apos;t)
        </summary>
        <div className="mt-2 grid gap-3 pb-1 text-[12.5px] leading-5 text-slate-700 sm:grid-cols-2">
          <div>
            <p className="font-semibold text-slate-900">I can answer questions about:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {SCOPE[audience].can.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-slate-900">I can&apos;t help with:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {SCOPE[audience].cannot.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
        {unavailable && (
          <InlineNotice>
            {availability === 'off'
              ? 'The assistant is turned off right now.'
              : 'The assistant is not set up yet. An admin can set it up in Settings, under AI Assistant.'}
          </InlineNotice>
        )}

        {messages.length === 0 && !unavailable && (
          <div className="mx-auto max-w-xl py-4 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#1f55a8]/10 text-[#1f55a8]">
              <Bot size={24} aria-hidden />
            </span>
            <p className="mt-3 font-display text-[16px] font-semibold text-slate-900">How can I help?</p>
            <p className="mt-1 text-[13px] leading-5 text-slate-500">
              I can answer questions about the health center and how to use the system. I can&apos;t see anyone&apos;s
              records, and I&apos;m not a doctor. For an emergency, go to the health center or nearest hospital.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS[audience].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  disabled={sending}
                  className="rounded-xl bg-white px-3.5 py-2.5 text-left text-[13px] text-slate-700 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-slate-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-6 sm:max-w-[75%]',
                m.role === 'user' ? 'bg-[#1f55a8] text-white' : 'bg-slate-100 text-slate-800',
              )}
            >
              {m.role === 'user' ? <p className="whitespace-pre-wrap">{m.content}</p> : <ReplyText text={m.content} />}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2.5 text-[13px] text-slate-500">
              <LoaderCircle size={14} className="animate-spin" aria-hidden /> Thinking…
            </div>
          </div>
        )}
        {error && <InlineNotice>{error}</InlineNotice>}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-slate-200/70 p-3 sm:p-4">
        <div className="flex items-end gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            rows={1}
            maxLength={MAX_LENGTH}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={unavailable}
            placeholder={unavailable ? 'The assistant is not available' : 'Ask a question…'}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-[#1f55a8] focus:ring-2 focus:ring-[#1f55a8]/20 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending || unavailable}
            aria-label="Send message"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#1f55a8] text-white transition-colors hover:bg-[#1a448a] disabled:opacity-50"
          >
            <Send size={18} aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-[11.5px] leading-4 text-slate-500">
          The assistant can make mistakes. Check important details with the health center. Never share passwords or
          codes. Chats are not saved and disappear when you leave this page.
        </p>
      </form>
    </section>
  );
}
