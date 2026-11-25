import { useState } from 'preact/hooks';
import { Plus, Trash2 } from 'lucide-preact';
import type { Strategy } from '../db/journalDb';

interface StrategiesTabProps {
  strategies: Strategy[];
  onSaveStrategy: (s: Strategy) => Promise<void>;
  onDeleteStrategy: (id: string) => Promise<void>;
}

export function StrategiesTab(props: StrategiesTabProps) {
  const [name, setName] = useState('');
  const [sourceBook, setSourceBook] = useState('');
  const [description, setDescription] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [color, setColor] = useState('#38bdf8');

  const handleAdd = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    const rules = rulesText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    await props.onSaveStrategy({
      id: `strat-${Date.now()}`,
      name: name.trim(),
      sourceBook: sourceBook.trim() || 'Tự xây dựng',
      description: description.trim(),
      rules: rules.length > 0 ? rules : ['Tuân thủ điểm vào & SL theo kế hoạch'],
      color,
      createdAt: Date.now(),
    });
    setName('');
    setSourceBook('');
    setDescription('');
    setRulesText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <form class="card" onSubmit={handleAdd}>
        <div class="card-title">Thêm trường phái giao dịch</div>
        <div class="grid-2" style={{ marginBottom: '6px' }}>
          <input
            class="input"
            placeholder="Tên trường phái..."
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            required
          />
          <input
            class="input"
            placeholder="Sách / Tác giả nguồn..."
            value={sourceBook}
            onInput={(e) => setSourceBook((e.target as HTMLInputElement).value)}
          />
        </div>
        <input
          class="input"
          style={{ width: '100%', marginBottom: '6px' }}
          placeholder="Mô tả ngắn..."
          value={description}
          onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
        />
        <textarea
          class="textarea"
          style={{ width: '100%', minHeight: '60px', marginBottom: '6px' }}
          placeholder="Mỗi dòng 1 quy tắc checklist..."
          value={rulesText}
          onInput={(e) => setRulesText((e.target as HTMLTextAreaElement).value)}
        />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="color"
            value={color}
            onInput={(e) => setColor((e.target as HTMLInputElement).value)}
          />
          <button type="submit" class="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
            <Plus size={14} /> Thêm trường phái
          </button>
        </div>
      </form>

      {props.strategies.map((s) => (
        <div class="card" key={s.id} style={{ borderLeft: `3px solid ${s.color}` }}>
          <div class="card-title">
            <span>{s.name}</span>
            <button
              type="button"
              class="btn"
              style={{ padding: '2px 6px' }}
              onClick={() => props.onDeleteStrategy(s.id)}
            >
              <Trash2 size={12} color="#FF3B5C" />
            </button>
          </div>
          <div style={{ fontSize: '11px', color: '#38bdf8', marginBottom: '4px' }}>
            {s.sourceBook}
          </div>
          <div style={{ fontSize: '11.5px', color: '#94a3b8', marginBottom: '6px' }}>
            {s.description}
          </div>
          <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11.5px', color: '#cbd5e1' }}>
            {s.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
