import { useEffect, useRef } from 'react';

interface Props {
  lines: string[];
  isLive?: boolean; // show blinking cursor if pipeline is still running
}

// Classify a log line for syntax highlighting
function lineClass(line: string): string {
  if (line.startsWith('[SimpleCI]')) return 'terminal-line simpleci';
  if (/✅|PASS|passed|success/i.test(line)) return 'terminal-line pass';
  if (/❌|FAIL|failed|error/i.test(line)) return 'terminal-line fail';
  return 'terminal-line';
}

export default function Terminal({ lines, isLive = false }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever new lines arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  return (
    <div className="terminal">
      {lines.length === 0 ? (
        <span style={{ color: 'var(--text-muted)' }}>Waiting for logs...</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className={lineClass(line)}>
            {line || '\u00A0' /* render empty lines as non-breaking space */}
          </div>
        ))
      )}
      {isLive && <span className="terminal-cursor" />}
      <div ref={bottomRef} />
    </div>
  );
}
