'use client';

import clsx from 'clsx';

interface Props {
  content: string;
  compact?: boolean;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index} className="font-bold text-tx-1">{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

export default function MarkdownMessage({ content, compact = false }: Props) {
  const blocks = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  return (
    <div className={clsx('break-words', compact ? 'space-y-1.5' : 'space-y-3')}>
      {blocks.map((block, blockIndex) => {
        if (/^-{3,}$/.test(block)) {
          return <div key={blockIndex} className="my-2 border-t border-bdr-2" />;
        }

        if (/^#{1,3}\s+/.test(block)) {
          const text = block.replace(/^#{1,3}\s+/, '');
          return (
            <h3 key={blockIndex} className={clsx('font-bold text-tx-1', compact ? 'text-xs' : 'text-sm')}>
              {renderInline(text)}
            </h3>
          );
        }

        const lines = block.split('\n').map(line => line.trimEnd()).filter(Boolean);
        const isList = lines.every(line => /^(\d+\.\s+|[-*]\s+|\s+-\s+)/.test(line));

        if (isList) {
          return (
            <div key={blockIndex} className={compact ? 'space-y-1' : 'space-y-1.5'}>
              {lines.map((line, lineIndex) => {
                const match = line.match(/^(\d+\.)\s+(.*)$/) ?? line.match(/^[-*]\s+(.*)$/) ?? line.match(/^\s+-\s+(.*)$/);
                const marker = line.match(/^(\d+\.)\s+/)?.[1] ?? '•';
                const text = match?.[2] ?? match?.[1] ?? line;
                return (
                  <div key={lineIndex} className="flex gap-2">
                    <span className="min-w-4 shrink-0 text-right text-tx-4">{marker}</span>
                    <span className="min-w-0 flex-1">{renderInline(text)}</span>
                  </div>
                );
              })}
            </div>
          );
        }

        return (
          <p key={blockIndex} className="whitespace-pre-wrap leading-relaxed">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}
