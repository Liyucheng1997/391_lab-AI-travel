import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from './Icon';

// ---------- 提示 ----------

let toastHost: HTMLDivElement | null = null;
export function toast(msg: string, kind: 'info' | 'success' | 'error' = 'info') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

// ---------- 对话框 ----------

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-header" style={{ cursor: 'default' }}>
          <span>{title}</span>
          <button className="modal-x" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={14} stroke={2.2} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** 命令式确认框 */
export function confirmDialog(opts: { title: string; message: string; okText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: boolean) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    function Confirm() {
      useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Enter') done(true);
          if (e.key === 'Escape') done(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, []);
      return (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
          <div className="modal confirm" style={{ width: 380 }}>
            <div className={'confirm-ico' + (opts.danger ? ' danger' : '')}>
              <Icon name={opts.danger ? 'trash' : 'check'} size={22} />
            </div>
            <div className="confirm-title">{opts.title}</div>
            <div className="confirm-msg">{opts.message}</div>
            <div className="confirm-actions">
              <button className="btn" onClick={() => done(false)}>
                取消
              </button>
              <button className={'btn ' + (opts.danger ? 'btn-danger-solid' : 'btn-primary')} onClick={() => done(true)} autoFocus>
                {opts.okText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      );
    }
    root.render(<Confirm />);
  });
}

// ---------- 分段控件 ----------

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- 下拉菜单 ----------

export function Menu({ trigger, items }: { trigger: ReactNode; items: ({ label: string; icon?: Parameters<typeof Icon>[0]['name']; danger?: boolean; onClick: () => void } | 'sep')[] }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
    };
  }, [pos]);
  return (
    <>
      <span
        style={{ display: 'contents' }}
        onClick={(e) => {
          const r = (e.target as HTMLElement).closest('button')?.getBoundingClientRect();
          if (r) setPos({ x: Math.min(r.right - 200, window.innerWidth - 208), y: r.bottom + 6 });
        }}
      >
        {trigger}
      </span>
      {pos && (
        <div className="popover menu" style={{ left: Math.max(8, pos.x), top: pos.y, width: 200 }} onMouseDown={(e) => e.stopPropagation()}>
          {items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="menu-sep" />
            ) : (
              <div
                key={i}
                className={'menu-item' + (it.danger ? ' danger' : '')}
                onClick={() => {
                  setPos(null);
                  it.onClick();
                }}
              >
                <span className="menu-icon">{it.icon && <Icon name={it.icon} size={16} />}</span>
                <span className="menu-label">{it.label}</span>
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}
