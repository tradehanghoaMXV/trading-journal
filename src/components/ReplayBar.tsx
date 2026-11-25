import { useEffect, useState } from 'preact/hooks';
import { Pause, Play, SkipForward, Square } from 'lucide-preact';
import type { ReplayState } from '@luxalgo/vela';

interface ReplayBarProps {
  replay: ReplayState;
  minTime: number;
  maxTime: number;
  onStartFrom: (fromMs: number) => void;
  onPlay: (intervalMs: number) => void;
  onPause: () => void;
  onStep: () => void;
  onStop: () => void;
}

export function ReplayBar(props: ReplayBarProps) {
  const computeDefault = () =>
    new Date(props.minTime + Math.floor((props.maxTime - props.minTime) * 0.7))
      .toISOString()
      .slice(0, 16);
  const [dateInput, setDateInput] = useState(computeDefault);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!props.replay.active) {
      setDateInput(computeDefault());
    }
  }, [props.minTime, props.maxTime, props.replay.active]);

  const intervalMs = Math.max(120, Math.round(1000 / speed));

  const handleApplyDate = () => {
    const ms = Date.parse(dateInput);
    if (Number.isFinite(ms)) {
      props.onStartFrom(ms);
    }
  };

  return (
    <div class="replay-bar" data-testid="replay-bar">
      <div class="topbar-group">
        <span class="pill pill-accent">CHẾ ĐỘ REPLAY</span>
        <label style={{ fontSize: '11.5px', color: '#94a3b8' }}>Từ ngày:</label>
        <input
          type="datetime-local"
          class="input"
          value={dateInput}
          onInput={(e) => setDateInput((e.target as HTMLInputElement).value)}
        />
        <button class="btn btn-primary" data-testid="replay-cut-btn" onClick={handleApplyDate}>
          Cắt nến tại đây
        </button>
      </div>

      <div class="topbar-group">
        {props.replay.active && (
          <>
            <button
              class="btn"
              data-testid="replay-play-pause-btn"
              onClick={() =>
                props.replay.playing ? props.onPause() : props.onPlay(intervalMs)
              }
            >
              {props.replay.playing ? <Pause size={13} /> : <Play size={13} />}
              {props.replay.playing ? 'Tạm dừng' : 'Chạy'}
            </button>

            <button class="btn" data-testid="replay-step-btn" onClick={props.onStep}>
              <SkipForward size={13} /> +1 nến
            </button>

            <select
              class="select"
              value={speed}
              onChange={(e) => {
                const next = Number((e.target as HTMLSelectElement).value);
                setSpeed(next);
                if (props.replay.playing) {
                  props.onPlay(Math.max(120, Math.round(1000 / next)));
                }
              }}
            >
              {[1, 2, 5, 10].map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>

            <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
              Còn {props.replay.remaining} nến
            </span>
          </>
        )}

        <button class="btn btn-bear" data-testid="replay-stop-btn" onClick={props.onStop}>
          <Square size={12} /> Thoát Replay
        </button>
      </div>
    </div>
  );
}
