import { useEffect, useState } from 'preact/hooks';
import { MapPin, Trash2 } from 'lucide-preact';
import type { ChartNote } from '../db/journalDb';
import { formatPrice } from '../config/symbols';

export interface NoteFormSeed {
  time: number;
  price: number;
}

interface NotesTabProps {
  symbol: string;
  lastPrice: number | null;
  notes: ChartNote[];
  seed: NoteFormSeed | null;
  onSaveNote: (note: ChartNote) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onClearSeed: () => void;
}

const NOTE_COLORS = ['#38bdf8', '#00F59B', '#f59e0b', '#a855f7', '#FF3B5C'];

export function NotesTab(props: NotesTabProps) {
  const [time, setTime] = useState<number>(Date.now());
  const [price, setPrice] = useState<string>(props.lastPrice ? String(props.lastPrice) : '');
  const [text, setText] = useState<string>('');
  const [color, setColor] = useState<string>('#38bdf8');

  useEffect(() => {
    if (props.seed) {
      setTime(props.seed.time);
      setPrice(String(props.seed.price));
    }
  }, [props.seed]);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const p = Number(price);
    if (!text.trim() || !Number.isFinite(p)) return;
    await props.onSaveNote({
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: props.symbol,
      time,
      price: p,
      text: text.trim(),
      color,
      createdAt: Date.now(),
    });
    setText('');
    props.onClearSeed();
  };

  const symbolNotes = props.notes
    .filter((n) => n.symbol === props.symbol)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <form class="card" onSubmit={handleSubmit} data-testid="note-form">
        <div class="card-title">
          <span>Ghim ghi chú lên chart ({props.symbol})</span>
        </div>

        <div class="grid-2" style={{ marginBottom: '8px' }}>
          <div>
            <label class="field-label">Mức giá ghim</label>
            <input
              class="input"
              data-testid="note-price-input"
              style={{ width: '100%' }}
              type="number"
              step="any"
              value={price}
              onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
              required
            />
          </div>
          <div>
            <label class="field-label">Màu ghim</label>
            <div style={{ display: 'flex', gap: '6px', paddingTop: '4px' }}>
              {NOTE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '2px solid #ffffff' : '1px solid #334155',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '8px' }}>
          <label class="field-label">Nội dung ghi chú</label>
          <textarea
            class="textarea"
            data-testid="note-text-input"
            style={{ width: '100%', minHeight: '64px' }}
            placeholder="Ví dụ: Vùng thanh khoản đỉnh cũ, chờ quét râu..."
            value={text}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            required
          />
        </div>

        <button type="submit" class="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} data-testid="save-note-btn">
          <MapPin size={14} /> Lưu ghi chú
        </button>
      </form>

      <div class="card">
        <div class="card-title">
          <span>Ghi chú trên {props.symbol} ({symbolNotes.length})</span>
        </div>
        {symbolNotes.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: '12px' }}>
            Chưa có ghi chú. Chọn công cụ Ghim ở thanh trái rồi click lên chart.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {symbolNotes.map((n) => (
              <div
                key={n.id}
                data-testid={`note-item-${n.id}`}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  background: '#0b0f17',
                  borderLeft: `3px solid ${n.color}`,
                  borderTop: '1px solid #1e293b',
                  borderRight: '1px solid #1e293b',
                  borderBottom: '1px solid #1e293b',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Giá: <strong style={{ color: '#f8fafc' }}>{formatPrice(n.price, n.symbol)}</strong> ·{' '}
                    {new Date(n.time).toLocaleString('vi-VN')}
                  </span>
                  <button
                    type="button"
                    class="btn"
                    style={{ padding: '2px 5px' }}
                    onClick={() => props.onDeleteNote(n.id)}
                  >
                    <Trash2 size={12} color="#FF3B5C" />
                  </button>
                </div>
                <div style={{ marginTop: '4px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                  {n.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
