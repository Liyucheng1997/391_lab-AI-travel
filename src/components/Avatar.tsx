import type { ReactNode } from 'react';
import { CATEGORY_ICON, avatarTone, initialOf } from '../lib/util';
import type { Category } from '../types';
import { Icon } from './Icon';

/** 地点头像：类型颜色的圆 + 白色图标，右下角可带编号或打卡徽标 */
export function PlaceAvatar({ category, size = 32, badge, visited }: { category: Category; size?: number; badge?: ReactNode; visited?: boolean }) {
  return (
    <span className={`pav cat-${category}`} style={{ width: size, height: size }}>
      <Icon name={CATEGORY_ICON[category]} size={Math.round(size * 0.5)} stroke={2} />
      {visited ? (
        <span className="pav-badge done">
          <Icon name="check" size={9} stroke={3.2} />
        </span>
      ) : (
        badge !== undefined && <span className="pav-badge">{badge}</span>
      )}
    </span>
  );
}

/** 人物头像：昵称首字 */
export function PersonAvatar({ name, size = 28, title }: { name: string; size?: number; title?: string }) {
  return (
    <span className={`person-av tone-${avatarTone(name)}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }} title={title ?? name}>
      {initialOf(name)}
    </span>
  );
}

export function AvatarStack({ names, size = 26, max = 4 }: { names: string[]; size?: number; max?: number }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className="av-stack" title={names.join('、')}>
      {shown.map((n) => (
        <PersonAvatar key={n} name={n} size={size} title="" />
      ))}
      {rest > 0 && (
        <span className="person-av more" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
          +{rest}
        </span>
      )}
    </span>
  );
}

/** 一趟行程里的人：我 + 同行的人 */
export function tripPeople(nickname: string, members: string[] | undefined): string[] {
  const me = nickname.trim() || '我';
  return [me, ...(members ?? []).filter((m) => m !== me)];
}
