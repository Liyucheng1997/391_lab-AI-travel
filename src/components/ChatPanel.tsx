import { useEffect, useMemo, useRef, useState } from 'react';
import { MissingKeyError, describeError, modelLabel, runAgent, toChatItems, toolLabel, type ChatPart, type MsgParam } from '../lib/ai';
import { ui } from '../lib/hooks';
import { clearChat, loadChat, saveChat, tripStore, useSettings } from '../lib/store';
import type { Trip } from '../types';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { confirmDialog, toast } from './ui';

const PENDING_KEY = 'tuji.pendingPrompt';

/** 首页输入的需求先存起来，进入行程页后自动发送 */
export const setPendingPrompt = (tripId: string, text: string) => sessionStorage.setItem(`${PENDING_KEY}.${tripId}`, text);

interface Stream {
  text: string;
  thinking: string;
  tool?: string;
}

export function ChatPanel({ trip, onClose }: { trip: Trip; onClose?: () => void }) {
  const settings = useSettings();
  const [history, setHistory] = useState<MsgParam[]>(() => loadChat<MsgParam>(trip.id));
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [stream, setStream] = useState<Stream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const items = useMemo(() => toChatItems(history), [history]);
  const empty = trip.days.every((d) => !d.places.length);

  useEffect(() => {
    setHistory(loadChat<MsgParam>(trip.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, stream]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || running) return;
    if (!settings.apiKey.trim()) {
      toast('先在设置里填入你的 Claude API Key');
      ui.openSettings();
      return;
    }
    setInput('');
    setError(null);
    setRunning(true);
    const ac = new AbortController();
    abort.current = ac;
    const before = history;
    let latest = history;
    try {
      await runAgent({
        tripId: trip.id,
        history,
        userText: msg,
        signal: ac.signal,
        cb: {
          onStream: setStream,
          onHistory: (h) => {
            latest = [...h];
            setHistory(latest);
            saveChat(trip.id, latest);
          },
        },
      });
    } catch (e) {
      if (e instanceof MissingKeyError) ui.openSettings();
      if (!ac.signal.aborted) setError(describeError(e));
      // 第一次请求就失败时，撤回这条消息并把文字放回输入框
      if (latest.length === before.length + 1) {
        setHistory(before);
        saveChat(trip.id, before);
        setInput(msg);
      }
    } finally {
      setRunning(false);
      setStream(null);
      abort.current = null;
    }
  };

  // 自动发送首页带过来的需求
  useEffect(() => {
    const key = `${PENDING_KEY}.${trip.id}`;
    const pending = sessionStorage.getItem(key);
    if (pending) {
      sessionStorage.removeItem(key);
      send(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const suggestions = empty
    ? ['帮我规划一个 3 天的行程，节奏轻松一些', '我想去巴黎 5 天，喜欢博物馆和甜点', '周末两天，从上海出发，适合带老人']
    : ['检查一下这个行程是否合理', '按顺路的顺序优化每天的路线', '第 1 天晚上加一家当地人常去的餐厅', '估算一下整趟旅行的总花费'];

  return (
    <div className="chat">
      <div className="chat-head">
        <div className="chat-ico">
          <Icon name="sparkles" size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="chat-title">AI 规划助手</div>
          <button className="chat-model" onClick={ui.openSettings}>
            {settings.apiKey ? modelLabel(settings.model) : '未设置 API Key'}
            <Icon name="chevronDown" size={12} />
          </button>
        </div>
        {history.length > 0 && !running && (
          <button
            className="icon-btn"
            title="清空对话"
            onClick={async () => {
              if (await confirmDialog({ title: '清空对话？', message: '只清空和 AI 的聊天记录，不影响行程。', okText: '清空' })) {
                clearChat(trip.id);
                setHistory([]);
                setError(null);
              }
            }}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
        {onClose && (
          <button className="icon-btn" onClick={onClose} title="收起">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      <div className="chat-body" ref={scroller}>
        {!items.length && !stream && (
          <div className="chat-empty">
            <div className="chat-empty-title">想怎么玩？</div>
            <div className="muted">告诉我目的地、天数和偏好，我会直接把行程排进地图里。也可以随时让我调整、补充或回答旅行问题。</div>
            <div className="suggest">
              {suggestions.map((s) => (
                <button key={s} className="suggest-item" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
            {!settings.apiKey && (
              <button className="btn btn-primary" onClick={ui.openSettings} style={{ marginTop: 8 }}>
                <Icon name="key" size={15} /> 设置 API Key
              </button>
            )}
          </div>
        )}
        {items.map((it, i) =>
          it.role === 'user' ? (
            <div key={i} className="msg-user">
              {it.text}
            </div>
          ) : (
            <div key={i} className="msg-ai">
              {it.parts.map((p, j) => (
                <Part key={j} part={p} />
              ))}
            </div>
          ),
        )}
        {stream && (
          <div className="msg-ai">
            {stream.thinking && !stream.text && <ThinkingPreview text={stream.thinking} />}
            {stream.text ? <Markdown text={stream.text} /> : null}
            <div className="typing">
              <span className="spinner sm" />
              {stream.tool ? toolLabel(stream.tool, {}).replace(/「」|\s+$/g, '') + '…' : stream.text ? '' : stream.thinking ? '思考中…' : '正在连接…'}
            </div>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={empty ? '例如：去成都 4 天，想吃火锅、看熊猫' : '让 AI 调整行程，或问任何旅行问题'}
          rows={1}
        />
        {running ? (
          <button type="button" className="send-btn stop" onClick={() => abort.current?.abort()} title="停止">
            <Icon name="stop" size={14} stroke={2.4} />
          </button>
        ) : (
          <button type="submit" className="send-btn" disabled={!input.trim()} title="发送">
            <Icon name="send" size={16} stroke={2.4} />
          </button>
        )}
      </form>
      {running && tripStore.canUndo(trip.id) && <div className="chat-hint">AI 的修改会实时显示在地图上，完成后可一键撤销</div>}
    </div>
  );
}

function ThinkingPreview({ text }: { text: string }) {
  return <div className="thinking-live">{text.slice(-160)}</div>;
}

function Part({ part }: { part: ChatPart }) {
  const [open, setOpen] = useState(false);
  if (part.type === 'text') return <Markdown text={part.text} />;
  if (part.type === 'thinking')
    return (
      <div className="thinking">
        <button onClick={() => setOpen(!open)}>
          <Icon name="sparkles" size={13} /> 思考过程 <Icon name="chevronDown" size={12} className={open ? 'rot' : ''} />
        </button>
        {open && <div className="thinking-text">{part.text}</div>}
      </div>
    );
  const done = part.result !== undefined;
  return (
    <div className={'tool-chip' + (part.isError ? ' err' : '')} title={part.result}>
      <span className={'dot' + (done ? (part.isError ? ' bad' : ' ok') : '')} />
      {toolLabel(part.name, part.input)}
    </div>
  );
}
