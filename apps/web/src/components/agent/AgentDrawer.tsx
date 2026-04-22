'use client';
// apps/web/src/components/agent/AgentDrawer.tsx

import { useRef, useEffect, useState, KeyboardEvent } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useUIStore, useChatStore, useUserStore } from '@/lib/store';
import { agentAPI } from '@/lib/api';
import type { ContentBundle } from '@/types';

const QUICK_ACTIONS = [
  { label: '🎬 Review TikTok',   msg: 'Viết script TikTok review kem dưỡng da Innisfree cho tôi', intent: 'content_create' },
  { label: '📘 Caption Facebook', msg: 'Tạo caption Facebook cho sản phẩm skincare giảm 35%',    intent: 'content_create' },
  { label: '🔥 Trend hôm nay',   msg: 'Top 5 trend Beauty đang hot hôm nay?',                    intent: 'trend_research' },
  { label: '💰 Top offers',      msg: 'Tìm top offers hoa hồng cao nhất phù hợp niche của tôi',   intent: 'offer_find' },
  { label: '📊 Phân tích',       msg: 'Báo cáo hiệu suất 30 ngày và 3 đề xuất cải thiện',        intent: 'performance_review' },
];

export default function AgentDrawer() {
  const { agentDrawerOpen, setAgentDrawer } = useUIStore();
  const { messages, isLoading, addMessage, updateMsg, setLoading } = useChatStore();
  const { deductCredit } = useUserStore();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus textarea when drawer opens
  useEffect(() => {
    if (agentDrawerOpen) setTimeout(() => textareaRef.current?.focus(), 300);
  }, [agentDrawerOpen]);

  async function sendMessage(text = input, intent?: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setInput('');
    setLoading(true);

    // Add user message
    addMessage({ role: 'user', content: trimmed, timestamp: Date.now() });

    // Add typing indicator
    const typingId = addMessage({
      role: 'assistant', content: '', timestamp: Date.now(), isTyping: true,
    });

    try {
      const result = await agentAPI.chat(trimmed, intent);
      deductCredit();

      // Replace typing with actual response
      updateMsg(typingId, {
        content:       result.content,
        structured:    result.structured as Record<string, unknown>,
        quality_score: result.quality_score,
        isTyping:      false,
      });
    } catch (err) {
      updateMsg(typingId, {
        content:  '⚠️ Lỗi kết nối AI. Vui lòng thử lại.',
        isTyping: false,
      });
      toast.error('Lỗi: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  return (
    <>
      {/* Backdrop */}
      {agentDrawerOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm"
             onClick={() => setAgentDrawer(false)} />
      )}

      {/* Drawer */}
      <aside className={clsx(
        'fixed right-0 top-12 bottom-0 w-[380px] bg-bg-1 border-l border-bdr-2',
        'flex flex-col z-50 shadow-2xl transition-transform duration-250',
        agentDrawerOpen ? 'translate-x-0' : 'translate-x-full'
      )}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-bdr-1 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-teal
                          flex items-center justify-center text-sm flex-shrink-0">🤖</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold">AffiliateAI Agent</p>
            <p className="text-[11px] text-tx-4 flex items-center gap-1.5">
              <span className="status-online" /> Online · Beauty niche
            </p>
          </div>
          <button onClick={() => setAgentDrawer(false)}
            className="btn btn-ghost btn-icon text-tx-3">✕</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {messages.length === 0 && (
            <div className="text-center py-8 animate-fade-in">
              <div className="text-3xl mb-3">🤖</div>
              <p className="text-xs font-semibold text-tx-2 mb-1">AffiliateAI sẵn sàng!</p>
              <p className="text-[11px] text-tx-4">
                Tôi có thể tạo content, tìm trend, phân tích hiệu suất và nhiều hơn nữa.
              </p>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id}
              className={clsx('flex gap-2.5 animate-fade-in', msg.role === 'user' && 'flex-row-reverse')}>
              {/* Avatar */}
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-brand to-teal
                                flex items-center justify-center text-xs flex-shrink-0 mt-0.5">🤖</div>
              )}

              {/* Bubble */}
              <div className={clsx(
                'max-w-[85%] rounded-xl px-3 py-2 text-xs',
                msg.role === 'user'
                  ? 'bg-brand text-white rounded-tr-sm'
                  : 'bg-bg-3 border border-bdr-2 rounded-tl-sm'
              )}>
                {msg.isTyping ? (
                  <div className="flex gap-1 items-center py-0.5 px-1">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-tx-3 inline-block"
                        style={{ animation: `bounce 1.2s ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    {/* Quality score */}
                    {msg.quality_score && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className={clsx('badge text-[9px]',
                          msg.quality_score >= 80 ? 'badge-green' :
                          msg.quality_score >= 65 ? 'badge-amber' : 'badge-rose')}>
                          ⭐ {msg.quality_score}/100
                        </span>
                        <button onClick={() => { navigator.clipboard.writeText(msg.content); toast.success('Đã copy!'); }}
                          className="text-[10px] text-tx-4 hover:text-tx-2 transition-colors">
                          📋 Copy
                        </button>
                        <button className="text-[10px] text-tx-4 hover:text-tx-2 transition-colors"
                          onClick={() => toast.success('🔄 Đang tạo lại...')}>
                          🔄 Tạo lại
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Quick actions */}
        <div className="px-3 py-2 border-t border-bdr-1 flex-shrink-0">
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_ACTIONS.map(qa => (
              <button key={qa.label} onClick={() => sendMessage(qa.msg, qa.intent)}
                disabled={isLoading}
                className="px-2 py-1 rounded-lg bg-bg-3 border border-bdr-2
                           text-[11px] text-tx-2 hover:border-brand/50 hover:text-brand-lighter
                           disabled:opacity-40 transition-all cursor-pointer">
                {qa.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="p-3 border-t border-bdr-1 flex gap-2 items-end flex-shrink-0">
          <textarea
            ref={textareaRef}
            className="textarea flex-1 text-xs"
            rows={1}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey}
            placeholder="Nhập yêu cầu... (Enter để gửi)"
            disabled={isLoading}
          />
          <button onClick={() => sendMessage()}
            disabled={isLoading || !input.trim()}
            className="btn btn-primary btn-icon flex-shrink-0">
            {isLoading
              ? <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3"/><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
              : '➤'}
          </button>
        </div>
      </aside>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: .4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </>
  );
}
