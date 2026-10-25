import { useState } from 'react';
import { MODELS, describeError, testConnection } from '../lib/ai';
import { useIsDark } from '../lib/hooks';
import { normalizeTrip, settingsStore, tripStore, useSettings } from '../lib/store';
import { sampleTrip } from '../lib/sample';
import { download, pickFile } from '../lib/util';
import type { Effort, Settings, ThemePref } from '../types';
import { Icon } from './Icon';
import { Modal, Seg, confirmDialog, toast } from './ui';

export function ThemeButton() {
  const dark = useIsDark();
  return (
    <button className="tb-round" title={dark ? '切换到浅色' : '切换到深色'} onClick={() => settingsStore.set({ theme: dark ? 'light' : 'dark' })}>
      <Icon name={dark ? 'sun' : 'moon'} size={17} />
    </button>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const saved = useSettings();
  const [f, setF] = useState<Settings>(saved);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<Settings>) => {
    setF((x) => ({ ...x, ...patch }));
    setTestMsg(null);
  };

  const save = () => {
    settingsStore.set({ ...f, apiKey: f.apiKey.trim(), baseURL: f.baseURL.trim() });
    toast('设置已保存', 'success');
    onClose();
  };

  const test = async () => {
    if (!f.apiKey.trim()) return setTestMsg({ ok: false, text: '请先填写 API Key' });
    setTesting(true);
    setTestMsg(null);
    try {
      const reply = await testConnection({ ...f, apiKey: f.apiKey.trim() });
      setTestMsg({ ok: true, text: `连接成功：${reply}` });
    } catch (e) {
      setTestMsg({ ok: false, text: describeError(e) });
    } finally {
      setTesting(false);
    }
  };

  const exportAll = () => download(`途迹-全部行程-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(tripStore.all(), null, 2));

  const importFile = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = (Array.isArray(data) ? data : [data]).map((t) => normalizeTrip(t, true)).filter(Boolean);
      if (!list.length) throw new Error('文件里没有可识别的行程');
      list.forEach((t) => tripStore.add(t!));
      toast(`导入了 ${list.length} 个行程`, 'success');
    } catch (e) {
      toast(`导入失败：${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  const reset = async () => {
    if (!(await confirmDialog({ title: '清空所有数据？', message: '会删除这个浏览器里的全部行程和 AI 对话，并恢复示例行程。API Key 设置会保留。', okText: '清空', danger: true })))
      return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith('tuji.v1.chat.'))
      .forEach((k) => localStorage.removeItem(k));
    tripStore.replaceAll([sampleTrip()]);
    toast('已恢复为示例数据');
  };

  return (
    <Modal
      title="设置"
      onClose={onClose}
      width={540}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="settings">
        <div className="set-section">
          <div className="set-label">CLAUDE API</div>
          <div className="form">
            <div className="form-row">
              <label className="form-label">API Key</label>
              <div className="input-wrap">
                <input
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  value={f.apiKey}
                  onChange={(e) => set({ apiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="icon-btn sm" onClick={() => setShowKey(!showKey)} title={showKey ? '隐藏' : '显示'} type="button">
                  <Icon name="eye" size={15} />
                </button>
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">认证方式</label>
              <Seg<Settings['authMode']>
                value={f.authMode}
                onChange={(v) => set({ authMode: v })}
                options={[
                  { value: 'apiKey', label: 'x-api-key' },
                  { value: 'bearer', label: 'Bearer Token' },
                ]}
              />
            </div>
            <div className="form-row">
              <label className="form-label">Base URL</label>
              <input className="input" value={f.baseURL} onChange={(e) => set({ baseURL: e.target.value })} placeholder="留空即官方 https://api.anthropic.com" spellCheck={false} />
            </div>
            <div className="form-row">
              <label className="form-label">模型</label>
              <select className="input" value={f.model} onChange={(e) => set({ model: e.target.value })}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.note}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">思考强度</label>
              <Seg<Effort>
                value={f.effort}
                onChange={(v) => set({ effort: v })}
                options={[
                  { value: 'low', label: '快速' },
                  { value: 'medium', label: '均衡' },
                  { value: 'high', label: '深入' },
                ]}
              />
            </div>
            <label className="form-check" style={{ paddingLeft: 104 }}>
              <input type="checkbox" checked={f.webSearch} onChange={(e) => set({ webSearch: e.target.checked })} />
              允许联网搜索（查开放时间、门票等最新信息，会额外计费）
            </label>
            <div className="form-row" style={{ paddingLeft: 104, gap: 10 }}>
              <button className="btn btn-sm" onClick={test} disabled={testing} type="button">
                {testing ? <span className="spinner sm" /> : <Icon name="check" size={14} />} 测试连接
              </button>
              {testMsg && <span className={'status-dot ' + (testMsg.ok ? 'ok' : 'bad')}>{testMsg.text}</span>}
            </div>
            <div className="set-note">
              Key 只保存在你自己浏览器的本地存储里，请求从浏览器直接发往 Anthropic（或你填写的 Base URL），本站没有服务器。在{' '}
              <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
                Claude 控制台
              </a>{' '}
              创建 Key。不要在公用电脑上保存 Key。自定义 Base URL 需要支持浏览器跨域（CORS）。
            </div>
          </div>
        </div>

        <div className="set-section">
          <div className="set-label">外观</div>
          <div className="form-row">
            <label className="form-label">主题</label>
            <Seg<ThemePref>
              value={f.theme}
              onChange={(v) => {
                set({ theme: v });
                settingsStore.set({ theme: v });
              }}
              options={[
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
                { value: 'system', label: '跟随系统' },
              ]}
            />
          </div>
        </div>

        <div className="set-section">
          <div className="set-label">数据</div>
          <div className="set-actions">
            <button className="btn btn-sm" onClick={exportAll} type="button">
              <Icon name="download" size={14} /> 导出全部行程
            </button>
            <button className="btn btn-sm" onClick={importFile} type="button">
              <Icon name="upload" size={14} /> 导入 JSON
            </button>
            <button className="btn btn-sm btn-danger" onClick={reset} type="button">
              <Icon name="trash" size={14} /> 清空数据
            </button>
          </div>
          <div className="set-note">所有行程都保存在这个浏览器里。换设备或清理浏览器数据前，记得先导出备份。</div>
        </div>
      </div>
    </Modal>
  );
}
