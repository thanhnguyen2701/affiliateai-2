'use client';

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  BarChart3,
  Bot,
  Clipboard,
  DollarSign,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  User,
} from 'lucide-react';
import { agentAPI } from '@/lib/api';
import { useChatStore, useUserStore } from '@/lib/store';
import MarkdownMessage from '@/components/agent/MarkdownMessage';

const QUICK_ACTIONS = [
  {
    label: 'TikTok review',
    intent: 'content_create',
    message: 'Viết script TikTok review kem chống nắng cho niche beauty, hook mạnh và CTA tự nhiên',
    icon: Sparkles,
  },
  {
    label: 'Caption Facebook',
    intent: 'content_create',
    message: 'Tạo caption Facebook cho sản phẩm skincare đang sale, giọng tự nhiên và có social proof không bịa',
    icon: MessageSquare,
  },
  {
    label: 'Trend hôm nay',
    intent: 'trend_research',
    message: 'Top 5 trend Beauty đang hot hôm nay?',
    icon: TrendingUp,
  },
  {
    label: 'Top offers',
    intent: 'offer_find',
    message: 'Tìm top offers hoa hồng cao nhất phù hợp niche của tôi',
    icon: DollarSign,
  },
  {
    label: 'Phân tích',
    intent: 'performance_review',
    message: 'Báo cáo hiệu suất 30 ngày và 3 đề xuất cải thiện',
    icon: BarChart3,
  },
] as const;

function qualityClass(score?: number) {
  if (!score) return 'badge-blue';
  if (score >= 80) return 'badge-green';
  if (score >= 65) return 'badge-amber';
  return 'badge-rose';
}

function intentLabel(intent?: string) {
  const labels: Record<string, string> = {
    content_create: 'Content',
    trend_research: 'Trend',
    offer_find: 'Offer',
    performance_review: 'Analytics',
    customer_reply: 'Trả lời',
    schedule_task: 'Lịch',
  };
  return intent ? labels[intent] ?? intent : 'Agent';
}

export default function ChatPageClient() {
  const router = useRouter();
  const { messages, isLoading, addMessage, updateMsg, setLoading, clearChat } = useChatStore();
  const deductCredit = useUserStore(s => s.deductCredit);
  const [input, setInput] = useState('');
  const [activeIntent, setActiveIntent] = useState<string | undefined>('content_create');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lastAssistant = useMemo(
    () => [...messages].reverse().find(message => message.role === 'assistant' && !message.isTyping),
    [messages]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success('Đã copy');
  }

  async function sendMessage(text = input, intent = activeIntent) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setLoading(true);
    addMessage({ role: 'user', content: trimmed, timestamp: Date.now() });
    const typingId = addMessage({ role: 'assistant', content: '', timestamp: Date.now(), isTyping: true });

    try {
      const result = await agentAPI.chat(trimmed, intent);
      deductCredit();
      const content = result.content?.trim() || 'AI đã phản hồi nhưng không có nội dung hiển thị.';

      updateMsg(typingId, {
        content,
        structured: {
          ...(result.structured as Record<string, unknown>),
          intent: result.intent,
          content_id: result.content_id,
        },
        quality_score: result.quality_score,
        isTyping: false,
      });

      if (result.intent === 'content_create') {
        window.dispatchEvent(new CustomEvent('affiliateai:content-created', {
          detail: { contentId: result.content_id ?? null },
        }));
        router.refresh();
      }
    } catch (error) {
      const message = (error as Error).message || 'Không rõ nguyên nhân';
      updateMsg(typingId, {
        content: `Lỗi kết nối AI: ${message}`,
        isTyping: false,
      });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="h-full min-h-[calc(100vh-48px)] flex flex-col bg-bg-0">
      <div className="border-b border-bdr-1 bg-bg-1/80 px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand-lighter">
                <Bot size={17} />
              </div>
              <div>
                <h1 className="text-sm font-bold text-tx-1">Chat AI</h1>
                <p className="text-[11px] text-tx-4">AffiliateAI Agent</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {lastAssistant?.quality_score ? (
              <span className={clsx('badge', qualityClass(lastAssistant.quality_score))}>
                <Star size={11} className="mr-1" />
                {lastAssistant.quality_score}/100
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                clearChat();
                toast.success('Đã xoá hội thoại');
              }}
              className="btn btn-ghost gap-1.5"
              disabled={isLoading || messages.length === 0}
            >
              <Trash2 size={13} />
              Xoá
            </button>
          </div>
        </div>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-h-0 flex-col border-b border-bdr-1 xl:border-b-0 xl:border-r">
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            {messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-4 py-10">
                <div className="rounded-lg border border-bdr-1 bg-bg-2 p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal/10 text-teal-light">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-tx-1">Sẵn sàng xử lý yêu cầu affiliate</p>
                      <p className="text-xs text-tx-4">Content, trend, offers và phân tích hiệu suất.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {QUICK_ACTIONS.slice(0, 4).map(action => {
                      const Icon = action.icon;
                      return (
                        <button
                          key={action.label}
                          type="button"
                          onClick={() => {
                            setActiveIntent(action.intent);
                            sendMessage(action.message, action.intent);
                          }}
                          disabled={isLoading}
                          className="flex min-h-[46px] items-center gap-2 rounded-lg border border-bdr-2 bg-bg-3 px-3 py-2 text-left text-xs text-tx-2 transition-colors hover:border-brand/40 hover:text-brand-lighter disabled:opacity-40"
                        >
                          <Icon size={15} className="shrink-0" />
                          <span className="truncate font-semibold">{action.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                {messages.map(message => {
                  const fromUser = message.role === 'user';
                  const intent = typeof message.structured?.intent === 'string' ? message.structured.intent : undefined;
                  return (
                    <div key={message.id} className={clsx('flex gap-3', fromUser && 'flex-row-reverse')}>
                      <div className={clsx(
                        'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                        fromUser
                          ? 'border-brand/30 bg-brand/10 text-brand-lighter'
                          : 'border-teal-light/20 bg-teal/10 text-teal-light'
                      )}>
                        {fromUser ? <User size={16} /> : <Bot size={16} />}
                      </div>

                      <div className={clsx('min-w-0 max-w-[82%]', fromUser && 'text-right')}>
                        <div className="mb-1 flex items-center gap-2 text-[10px] text-tx-4">
                          <span>{fromUser ? 'Bạn' : intentLabel(intent)}</span>
                          <span>{new Date(message.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                          {!fromUser && message.quality_score ? (
                            <span className={clsx('badge text-[9px]', qualityClass(message.quality_score))}>
                              {message.quality_score}/100
                            </span>
                          ) : null}
                        </div>

                        <div className={clsx(
                          'rounded-lg border px-3 py-2 text-left text-xs leading-relaxed shadow-sm',
                          fromUser
                            ? 'border-brand/25 bg-brand text-white'
                            : 'border-bdr-1 bg-bg-2 text-tx-2'
                        )}>
                          {message.isTyping ? (
                            <div className="flex items-center gap-2 py-1 text-tx-3">
                              <Loader2 size={14} className="animate-spin" />
                              <span>Đang xử lý</span>
                            </div>
                          ) : (
                            <MarkdownMessage content={message.content} />
                          )}
                        </div>

                        {!fromUser && !message.isTyping ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => copyText(message.content)}
                              className="btn btn-ghost btn-sm gap-1.5"
                            >
                              <Clipboard size={12} />
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => sendMessage(`Tối ưu lại nội dung này, giữ ý chính nhưng làm hay hơn:\n\n${message.content}`, intent)}
                              disabled={isLoading}
                              className="btn btn-ghost btn-sm gap-1.5"
                            >
                              <RefreshCw size={12} />
                              Tối ưu
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="border-t border-bdr-1 bg-bg-1 p-3">
            <div className="mx-auto max-w-4xl">
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {QUICK_ACTIONS.map(action => {
                  const Icon = action.icon;
                  const active = activeIntent === action.intent;
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => setActiveIntent(action.intent)}
                      className={clsx(
                        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors',
                        active
                          ? 'border-brand/40 bg-brand/10 text-brand-lighter'
                          : 'border-bdr-2 bg-bg-3 text-tx-3 hover:border-bdr-3 hover:text-tx-2'
                      )}
                    >
                      <Icon size={13} />
                      {action.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={1}
                  onChange={event => {
                    setInput(event.target.value);
                    autoResize(event.currentTarget);
                  }}
                  onKeyDown={handleKey}
                  disabled={isLoading}
                  placeholder="Nhập yêu cầu..."
                  className="textarea min-h-[42px] flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={isLoading || !input.trim()}
                  className="btn btn-primary h-[42px] w-[42px] justify-center p-0"
                  aria-label="Send"
                >
                  {isLoading ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="hidden min-h-0 overflow-y-auto bg-bg-1 p-4 scrollbar-thin xl:block">
          <div className="space-y-4">
            <div className="rounded-lg border border-bdr-1 bg-bg-2 p-4">
              <p className="mb-3 text-xs font-bold text-tx-2">Tác vụ nhanh</p>
              <div className="space-y-2">
                {QUICK_ACTIONS.map(action => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        setActiveIntent(action.intent);
                        sendMessage(action.message, action.intent);
                      }}
                      disabled={isLoading}
                      className="flex w-full items-center gap-2 rounded-lg border border-bdr-2 bg-bg-3 px-3 py-2 text-left text-xs text-tx-2 transition-colors hover:border-brand/40 hover:text-brand-lighter disabled:opacity-40"
                    >
                      <Icon size={14} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-semibold">{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-bdr-1 bg-bg-2 p-4">
              <p className="mb-3 text-xs font-bold text-tx-2">Phiên hiện tại</p>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-tx-4">Tin nhắn</span>
                  <span className="font-semibold text-tx-2">{messages.length}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-tx-4">Intent</span>
                  <span className="font-semibold text-tx-2">{intentLabel(activeIntent)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-tx-4">Điểm gần nhất</span>
                  <span className={clsx('badge', qualityClass(lastAssistant?.quality_score))}>
                    {lastAssistant?.quality_score ? `${lastAssistant.quality_score}/100` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
