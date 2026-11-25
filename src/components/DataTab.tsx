import { useState } from 'preact/hooks';
import { Download, Trash2, Upload } from 'lucide-preact';
import { exportJournalJson, importJournalJson } from '../db/journalDb';

interface DataTabProps {
  tradeCount: number;
  noteCount: number;
  strategyCount: number;
  onReloadData: () => Promise<void>;
  onClearAllTradesAndNotes: () => Promise<void>;
}

export function DataTab(props: DataTabProps) {
  const [msg, setMsg] = useState('');

  const handleExport = async () => {
    const payload = await exportJournalJson();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nhat-ky-giao-dich-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('Đã xuất file JSON thành công.');
  };

  const handleImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await importJournalJson(parsed);
      await props.onReloadData();
      setMsg('Đã nhập dữ liệu JSON thành công.');
    } catch (err) {
      setMsg(`Lỗi nhập JSON: ${err instanceof Error ? err.message : 'Không hợp lệ'}`);
    }
    input.value = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div class="card">
        <div class="card-title">Trạng thái IndexedDB (Dexie)</div>
        <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.7 }}>
          <div>• Trường phái: <strong>{props.strategyCount}</strong></div>
          <div>• Lệnh đã lưu: <strong>{props.tradeCount}</strong></div>
          <div>• Ghi chú trên chart: <strong>{props.noteCount}</strong></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Sao lưu & Khôi phục JSON</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button class="btn btn-primary" style={{ justifyContent: 'center' }} onClick={handleExport}>
            <Download size={14} /> Xuất toàn bộ dữ liệu (JSON)
          </button>

          <label class="btn" style={{ justifyContent: 'center', cursor: 'pointer' }}>
            <Upload size={14} /> Nhập dữ liệu từ JSON
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
          </label>

          <button
            class="btn btn-bear"
            style={{ justifyContent: 'center' }}
            onClick={async () => {
              await props.onClearAllTradesAndNotes();
              setMsg('Đã xóa toàn bộ lệnh và ghi chú.');
            }}
          >
            <Trash2 size={14} /> Xóa toàn bộ lệnh & ghi chú
          </button>

          {msg && (
            <div class="pill pill-accent" style={{ justifyContent: 'center' }}>
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
