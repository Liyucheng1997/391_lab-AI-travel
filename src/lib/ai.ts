import Anthropic from '@anthropic-ai/sdk';
import type { Category, Place, RouteMode, Settings, Trip } from '../types';
import { geocodeForAgent } from './agentGeo';
import { optimizeOrder } from './geo';
import { emptyDay, settingsStore, tripStore } from './store';
import { CATEGORY_LABEL, fmtDayDate, uid } from './util';

export type MsgParam = Anthropic.Beta.BetaMessageParam;

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: '规划能力最强' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: '速度与能力平衡' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: '最快、最省钱' },
];

export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

export class MissingKeyError extends Error {
  constructor() {
    super('还没有设置 API Key');
  }
}

export function makeClient(s: Settings) {
  const key = s.apiKey.trim();
  return new Anthropic({
    apiKey: s.authMode === 'apiKey' ? key : null,
    authToken: s.authMode === 'bearer' ? key : null,
    baseURL: s.baseURL.trim().replace(/\/+$/, '') || undefined,
    // 纯前端应用：Key 只存在用户自己的浏览器里，请求直接发往 Anthropic
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });
}

/** 把 SDK 的错误翻译成用户看得懂的话 */
export function describeError(err: unknown): string {
  if (err instanceof MissingKeyError) return err.message;
  if (err instanceof Anthropic.APIUserAbortError) return '已停止';
  if (err instanceof Anthropic.AuthenticationError) return 'API Key 无效或已过期，请在设置里检查。';
  if (err instanceof Anthropic.PermissionDeniedError) return '这个 Key 没有调用该模型的权限。';
  if (err instanceof Anthropic.NotFoundError) return '找不到这个模型或接口地址，请检查设置里的模型和 Base URL。';
  if (err instanceof Anthropic.RateLimitError) return '请求太频繁或额度不足，请稍后再试。';
  if (err instanceof Anthropic.BadRequestError) return `请求被拒绝：${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return 'Anthropic 服务暂时不可用，请稍后重试。';
  if (err instanceof Anthropic.APIConnectionError)
    return '连不上 API。请检查网络；如果用了自定义 Base URL，它需要允许浏览器跨域（CORS）访问。';
  if (err instanceof Anthropic.APIError) return `API 错误 ${err.status ?? ''}：${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

// ---------- 提示词与工具 ----------

const SYSTEM = `你是「途迹」里的 AI 旅行规划助手。用户在一个地图行程规划网页里和你对话，你可以用工具直接读写当前这份行程：天数、每天的地点（含坐标）、到达时间、停留时长、花费和备注。地点会实时显示在用户的地图上，并按顺序连成路线。

工作方式：
- 用户让你规划、增删或调整行程时，直接调用工具修改，而不是只在文字里描述方案。改完后用几句话说明做了什么、这样安排的理由，以及需要用户确认或补充的信息。
- 用户只是提问（签证、天气、交通卡、当地习俗、预算等）时直接回答，不必修改行程。
- 用户消息前可能附有 <trip_snapshot>，那是行程的最新状态，方括号里是地点 id。修改已有地点时使用这些 id。天数从 1 开始编号。
- 坐标要准确。知名地标可以直接给出坐标；不确定的地点（具体的餐厅、酒店、小众景点）先用 geocode 查询，再从结果里挑对的那个。不要编造不存在的店铺。
- 安排要现实：同一天的地点在地理上相近，按顺路的顺序排列；考虑开放时间、路上的交通时间和吃饭时间；给每个地点填 time（HH:MM）和 duration（分钟）；住宿放在当天最后；花费按行程币种估算后填在 cost。
- 一次规划多天时，可以在同一回合里并行调用多个 add_places，每天一个。
- 如果行程还是空的，而用户给了目的地和天数：先用 set_trip_info 设好名称、目的地和日期，再用 set_day_count 设好天数，然后逐天添加地点，并用 update_day 给每天起一个简短的主题。
- 用用户的语言回答（默认简体中文），简洁，多用短段落和列表。`;

const placeProps = {
  name: { type: 'string', description: '地点名称，使用用户的语言，可附当地名称' },
  lat: { type: 'number', description: '纬度' },
  lng: { type: 'number', description: '经度' },
  category: { type: 'string', enum: ['sight', 'food', 'hotel', 'transport', 'shopping', 'activity', 'other'] },
  time: { type: 'string', description: '计划到达时间，HH:MM' },
  duration: { type: 'integer', description: '停留时长，分钟' },
  cost: { type: 'number', description: '预计花费，行程币种' },
  address: { type: 'string' },
  notes: { type: 'string', description: '给用户的简短提示，如门票、预约、推荐菜' },
} as const;

type ToolDef = Anthropic.Beta.BetaTool;
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  name,
  description,
  input_schema: { type: 'object', properties, required },
  eager_input_streaming: true,
});

const TOOLS: ToolDef[] = [
  tool(
    'set_trip_info',
    '修改行程的基本信息。只传需要修改的字段。',
    {
      name: { type: 'string' },
      destination: { type: 'string' },
      start_date: { type: 'string', description: '出发日期 YYYY-MM-DD；传空字符串表示未定' },
      currency: { type: 'string', description: 'ISO 币种代码，如 CNY、JPY、EUR' },
      budget: { type: 'number', description: '总预算，行程币种' },
      notes: { type: 'string', description: '整趟旅行的备注' },
    },
  ),
  tool(
    'set_day_count',
    '把行程设为指定天数。增加时在末尾补空白天；减少时删除末尾的天及其中的地点。',
    { count: { type: 'integer', minimum: 1, maximum: 60 } },
    ['count'],
  ),
  tool(
    'update_day',
    '修改某一天的标题、备注或路线方式。',
    {
      day: { type: 'integer', description: '第几天，从 1 开始' },
      title: { type: 'string', description: '当天主题，简短，如「东山寺庙线」' },
      notes: { type: 'string' },
      route_mode: { type: 'string', enum: ['driving', 'walking', 'cycling', 'straight'], description: '地图上路线的计算方式；straight 用于航班等' },
    },
    ['day'],
  ),
  tool(
    'add_places',
    '向某一天添加一个或多个地点，按游览顺序。若没有给出 lat/lng，会用 name（或 query）自动查询坐标。',
    {
      day: { type: 'integer', description: '第几天，从 1 开始' },
      position: { type: 'integer', description: '插入到当天第几个位置（从 1 开始）；省略则追加到末尾' },
      places: {
        type: 'array',
        items: {
          type: 'object',
          properties: { ...placeProps, query: { type: 'string', description: '没有坐标时用于查询的关键词' } },
          required: ['name', 'category'],
        },
      },
    },
    ['day', 'places'],
  ),
  tool('update_place', '修改一个已有地点。只传需要修改的字段。', { place_id: { type: 'string' }, ...placeProps, visited: { type: 'boolean', description: '是否已打卡' } }, [
    'place_id',
  ]),
  tool('remove_places', '删除一个或多个地点。', { place_ids: { type: 'array', items: { type: 'string' } } }, ['place_ids']),
  tool(
    'move_place',
    '把一个地点移到另一天（或同一天的另一个位置）。',
    { place_id: { type: 'string' }, to_day: { type: 'integer' }, position: { type: 'integer', description: '从 1 开始；省略则放到末尾' } },
    ['place_id', 'to_day'],
  ),
  tool(
    'reorder_day',
    '按给定的 id 顺序重排某一天的地点。必须包含当天所有地点的 id。',
    { day: { type: 'integer' }, place_ids: { type: 'array', items: { type: 'string' } } },
    ['day', 'place_ids'],
  ),
  tool('optimize_day_route', '自动把某一天的地点按最短路线重新排序（第一个地点和末尾的住宿/交通保持不动）。', { day: { type: 'integer' } }, ['day']),
  tool('remove_day', '删除某一天及其中的所有地点。', { day: { type: 'integer' } }, ['day']),
  tool(
    'geocode',
    '用 OpenStreetMap 查询地点坐标，返回最多 5 个候选。query 最好带上城市名。',
    { query: { type: 'string' } },
    ['query'],
  ),
];

// ---------- 行程快照 ----------

function placeLine(p: Place, i: number) {
  const bits = [`${i + 1}. [${p.id}] ${p.name}`, `(${p.lat.toFixed(5)},${p.lng.toFixed(5)})`, CATEGORY_LABEL[p.category]];
  if (p.time) bits.push(p.time);
  if (p.duration) bits.push(`停留${p.duration}分`);
  if (p.cost !== undefined) bits.push(`花费${p.cost}`);
  if (p.visited) bits.push('已打卡');
  if (p.notes) bits.push(`备注:${p.notes.replace(/\s+/g, ' ').slice(0, 120)}`);
  return '  ' + bits.join(' ');
}

export function tripSnapshot(trip: Trip): string {
  const today = new Date();
  const lines = [
    '<trip_snapshot>',
    `行程：${trip.name}｜目的地：${trip.destination || '未定'}｜出发日期：${trip.startDate || '未定'}｜共 ${trip.days.length} 天｜币种：${trip.currency}${
      trip.budget ? `｜预算：${trip.budget}` : ''
    }`,
    `今天是 ${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,
  ];
  if (trip.notes) lines.push(`行程备注：${trip.notes}`);
  trip.days.forEach((d, i) => {
    lines.push(`第${i + 1}天 ${fmtDayDate(trip, i)}${d.title ? ` 「${d.title}」` : ''} 路线:${d.routeMode}${d.notes ? ` 备注:${d.notes}` : ''}`);
    if (!d.places.length) lines.push('  （空）');
    d.places.forEach((p, j) => lines.push(placeLine(p, j)));
  });
  lines.push('</trip_snapshot>');
  return lines.join('\n');
}

const SNAPSHOT_PREFIX = '<trip_snapshot>';
export const isSnapshotText = (t: string) => t.startsWith(SNAPSHOT_PREFIX);

// ---------- 工具执行 ----------

class ToolError extends Error {}

const CATS: Category[] = ['sight', 'food', 'hotel', 'transport', 'shopping', 'activity', 'other'];
const MODES: RouteMode[] = ['driving', 'walking', 'cycling', 'straight'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);

function dayIndex(trip: Trip, day: unknown): number {
  if (!Number.isInteger(day) || (day as number) < 1 || (day as number) > trip.days.length)
    throw new ToolError(`day 必须是 1 到 ${trip.days.length} 之间的整数`);
  return (day as number) - 1;
}

function findPlace(trip: Trip, id: unknown) {
  for (let di = 0; di < trip.days.length; di++) {
    const pi = trip.days[di].places.findIndex((p) => p.id === id);
    if (pi >= 0) return { di, pi, place: trip.days[di].places[pi] };
  }
  throw new ToolError(`找不到地点 ${String(id)}`);
}

function applyPlaceFields(target: Partial<Place>, input: Record<string, unknown>) {
  const name = optStr(input.name);
  if (name) target.name = name.slice(0, 200);
  if (isNum(input.lat) && Math.abs(input.lat) <= 90) target.lat = input.lat;
  if (isNum(input.lng) && Math.abs(input.lng) <= 180) target.lng = input.lng;
  if (CATS.includes(input.category as Category)) target.category = input.category as Category;
  if (typeof input.time === 'string') target.time = /^\d{1,2}:\d{2}$/.test(input.time) ? input.time.padStart(5, '0') : undefined;
  if (isNum(input.duration)) target.duration = Math.max(0, Math.round(input.duration));
  if (isNum(input.cost)) target.cost = Math.max(0, input.cost);
  if (typeof input.address === 'string') target.address = input.address.slice(0, 300) || undefined;
  if (typeof input.notes === 'string') target.notes = input.notes.slice(0, 2000) || undefined;
  if (typeof input.visited === 'boolean') target.visited = input.visited || undefined;
}

async function runTool(tripId: string, name: string, input: Record<string, unknown>): Promise<string> {
  const trip = tripStore.get(tripId);
  if (!trip) throw new ToolError('行程已被删除');
  const mutate = (fn: (t: Trip) => void) => tripStore.update(tripId, fn, { undo: false });

  switch (name) {
    case 'set_trip_info': {
      mutate((t) => {
        const n = optStr(input.name);
        if (n) t.name = n.slice(0, 100);
        const d = optStr(input.destination);
        if (d !== undefined) t.destination = d.slice(0, 100);
        if (typeof input.start_date === 'string') {
          if (input.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) throw new ToolError('start_date 格式应为 YYYY-MM-DD');
          t.startDate = input.start_date || undefined;
        }
        const c = optStr(input.currency);
        if (c) t.currency = c.toUpperCase().slice(0, 8);
        if (isNum(input.budget)) t.budget = input.budget;
        if (typeof input.notes === 'string') t.notes = input.notes || undefined;
      });
      return '已更新行程信息';
    }
    case 'set_day_count': {
      const count = input.count;
      if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 60) throw new ToolError('count 必须是 1–60 的整数');
      let removed = 0;
      mutate((t) => {
        while (t.days.length < (count as number)) t.days.push(emptyDay());
        while (t.days.length > (count as number)) removed += t.days.pop()!.places.length;
      });
      return `行程现在共 ${count} 天${removed ? `，删除了 ${removed} 个地点` : ''}`;
    }
    case 'update_day': {
      const di = dayIndex(trip, input.day);
      mutate((t) => {
        const d = t.days[di];
        if (typeof input.title === 'string') d.title = input.title.slice(0, 100) || undefined;
        if (typeof input.notes === 'string') d.notes = input.notes || undefined;
        if (MODES.includes(input.route_mode as RouteMode)) d.routeMode = input.route_mode as RouteMode;
      });
      return `已更新第 ${di + 1} 天`;
    }
    case 'add_places': {
      const di = dayIndex(trip, input.day);
      if (!Array.isArray(input.places) || !input.places.length) throw new ToolError('places 不能为空');
      const added: Place[] = [];
      const failed: string[] = [];
      for (const raw of input.places.slice(0, 40)) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const p: Partial<Place> = { id: uid(), category: 'other' };
        applyPlaceFields(p, r);
        if (!p.name) continue;
        if (p.lat === undefined || p.lng === undefined) {
          const hit = (await geocodeForAgent(optStr(r.query) || p.name, trip.destination))[0];
          if (!hit) {
            failed.push(p.name);
            continue;
          }
          p.lat = hit.lat;
          p.lng = hit.lng;
          p.address ??= hit.displayName.slice(0, 300);
        }
        added.push(p as Place);
      }
      if (added.length) {
        mutate((t) => {
          const list = t.days[di].places;
          const pos = Number.isInteger(input.position) ? Math.min(Math.max((input.position as number) - 1, 0), list.length) : list.length;
          list.splice(pos, 0, ...added);
        });
      }
      const ids = added.map((p) => `${p.name}=${p.id}`).join('，');
      return `第 ${di + 1} 天添加了 ${added.length} 个地点${ids ? `：${ids}` : ''}${failed.length ? `。查不到坐标、未添加：${failed.join('，')}` : ''}`;
    }
    case 'update_place': {
      findPlace(trip, input.place_id);
      mutate((t) => applyPlaceFields(findPlace(t, input.place_id).place, input));
      return '已更新地点';
    }
    case 'remove_places': {
      const ids = Array.isArray(input.place_ids) ? input.place_ids.map(String) : [];
      let n = 0;
      mutate((t) =>
        t.days.forEach((d) => {
          const before = d.places.length;
          d.places = d.places.filter((p) => !ids.includes(p.id));
          n += before - d.places.length;
        }),
      );
      return `删除了 ${n} 个地点`;
    }
    case 'move_place': {
      findPlace(trip, input.place_id);
      const to = dayIndex(trip, input.to_day);
      mutate((t) => {
        const { di, pi } = findPlace(t, input.place_id);
        const [p] = t.days[di].places.splice(pi, 1);
        const list = t.days[to].places;
        const pos = Number.isInteger(input.position) ? Math.min(Math.max((input.position as number) - 1, 0), list.length) : list.length;
        list.splice(pos, 0, p);
      });
      return `已移到第 ${to + 1} 天`;
    }
    case 'reorder_day': {
      const di = dayIndex(trip, input.day);
      const ids = Array.isArray(input.place_ids) ? input.place_ids.map(String) : [];
      const cur = trip.days[di].places;
      if (ids.length !== cur.length || !cur.every((p) => ids.includes(p.id))) throw new ToolError('place_ids 必须恰好包含当天的所有地点 id');
      mutate((t) => {
        const byId = new Map(t.days[di].places.map((p) => [p.id, p]));
        t.days[di].places = ids.map((id) => byId.get(id)!);
      });
      return `已重排第 ${di + 1} 天`;
    }
    case 'optimize_day_route': {
      const di = dayIndex(trip, input.day);
      const next = optimizeOrder(trip.days[di].places);
      mutate((t) => {
        t.days[di].places = next;
      });
      return `第 ${di + 1} 天的新顺序：${next.map((p) => p.name).join(' → ')}`;
    }
    case 'remove_day': {
      const di = dayIndex(trip, input.day);
      if (trip.days.length === 1) throw new ToolError('至少要保留一天');
      mutate((t) => {
        t.days.splice(di, 1);
      });
      return `已删除第 ${di + 1} 天，后面的天数编号依次前移`;
    }
    case 'geocode': {
      const q = optStr(input.query);
      if (!q) throw new ToolError('query 不能为空');
      const hits = await geocodeForAgent(q, '');
      if (!hits.length) return '没有找到结果，可以换个关键词（加上城市名或用当地语言）';
      return hits.map((h, i) => `${i + 1}. ${h.name} (${h.lat.toFixed(5)},${h.lng.toFixed(5)}) ${h.displayName}`).join('\n');
    }
    default:
      throw new ToolError(`未知工具 ${name}`);
  }
}

// ---------- 对话循环 ----------

export interface AgentCallbacks {
  /** 当前这一轮回复的流式文本 */
  onStream(state: { text: string; thinking: string; tool?: string }): void;
  /** 历史有新消息时调用（用于保存和重绘） */
  onHistory(history: MsgParam[]): void;
}

function lastSnapshotIn(history: MsgParam[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const b of m.content) if (b.type === 'text' && isSnapshotText(b.text)) return b.text;
  }
  return undefined;
}

function supportsFallback(s: Settings) {
  const official = !s.baseURL.trim() || /^https:\/\/api\.anthropic\.com\/?$/.test(s.baseURL.trim());
  return official && (s.model === 'claude-opus-5-5' || s.model === 'claude-sonnet-5-5');
}

export async function runAgent(opts: { tripId: string; history: MsgParam[]; userText: string; signal: AbortSignal; cb: AgentCallbacks }) {
  const { tripId, userText, signal, cb } = opts;
  const s = settingsStore.get();
  if (!s.apiKey.trim()) throw new MissingKeyError();
  const trip = tripStore.get(tripId);
  if (!trip) throw new Error('行程不存在');

  const client = makeClient(s);
  const history = [...opts.history];

  // 行程和上一份快照不一样时（AI 或用户改过）才附上新快照
  const snap = tripSnapshot(trip);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (lastSnapshotIn(history) !== snap) content.push({ type: 'text', text: snap });
  content.push({ type: 'text', text: userText });
  history.push({ role: 'user', content });
  cb.onHistory(history);

  // 整次 AI 运行只存一个撤销点
  tripStore.checkpoint(tripId);

  const tools: Anthropic.Beta.BetaToolUnion[] = [...TOOLS];
  if (s.webSearch) tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 });
  const fallback = supportsFallback(s);
  let jsonRetries = 0;

  for (let iter = 0; iter < 30; iter++) {
    let text = '';
    let thinking = '';
    cb.onStream({ text, thinking });

    const stream = client.beta.messages.stream(
      {
        model: s.model,
        max_tokens: 64000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        cache_control: { type: 'ephemeral' },
        tools,
        messages: history,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: s.effort },
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );

    for await (const ev of stream) {
      if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') text += ev.delta.text;
        else if (ev.delta.type === 'thinking_delta') thinking += ev.delta.thinking;
        else continue;
        cb.onStream({ text, thinking });
      } else if (ev.type === 'content_block_start' && (ev.content_block.type === 'tool_use' || ev.content_block.type === 'server_tool_use')) {
        cb.onStream({ text, thinking, tool: ev.content_block.name });
      }
    }

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // 只有工具参数 JSON 无法解析时重试，API 错误直接抛出
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === 'refusal') {
      if (message.content.length) {
        history.push({ role: 'assistant', content: message.content });
        cb.onHistory(history);
      }
      throw new Error('这个请求被模型的安全策略拒绝了，换个说法试试。');
    }
    if (!message.content.length) break;

    history.push({ role: 'assistant', content: message.content });
    cb.onHistory(history);

    if (message.stop_reason === 'pause_turn') continue;

    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (!uses.length) break;
    if (message.stop_reason === 'max_tokens') throw new Error('回复太长被截断了，请把需求拆小一点再试。');

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const input = u.input && typeof u.input === 'object' ? (u.input as Record<string, unknown>) : null;
      try {
        if (!input) throw new ToolError('参数必须是 JSON 对象');
        results.push({ type: 'tool_result', tool_use_id: u.id, content: await runTool(tripId, u.name, input) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: e instanceof Error ? e.message : String(e) });
      }
    }
    history.push({ role: 'user', content: results });
    cb.onHistory(history);
    if (signal.aborted) break;
  }
  return history;
}

/** 设置页的「测试连接」 */
export async function testConnection(s: Settings): Promise<string> {
  const client = makeClient(s);
  const res = await client.messages.create({
    model: s.model,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: '用一句话向旅行者问好。' }],
  });
  const t = res.content.find((b) => b.type === 'text');
  return t && t.type === 'text' ? t.text : '连接成功';
}

// ---------- 把 API 历史转成界面上显示的对话 ----------

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; name: string; input: any; result?: string; isError?: boolean };

export type ChatItem = { role: 'user'; text: string } | { role: 'assistant'; parts: ChatPart[] };

export function toChatItems(history: MsgParam[]): ChatItem[] {
  const items: ChatItem[] = [];
  const tools = new Map<string, Extract<ChatPart, { type: 'tool' }>>();
  const assistant = () => {
    const last = items[items.length - 1];
    if (last?.role === 'assistant') return last;
    const a: ChatItem = { role: 'assistant', parts: [] };
    items.push(a);
    return a;
  };

  for (const m of history) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content } as const] : (m.content ?? []);
    if (m.role === 'user') {
      const text = blocks
        .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text' && !isSnapshotText(b.text))
        .map((b) => b.text)
        .join('\n');
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const part = tools.get(b.tool_use_id);
          if (part) {
            part.result = typeof b.content === 'string' ? b.content : '';
            part.isError = b.is_error === true;
          }
        }
      }
      if (text) items.push({ role: 'user', text });
    } else {
      const a = assistant();
      for (const b of blocks as any[]) {
        if (b.type === 'text' && b.text) a.parts.push({ type: 'text', text: b.text });
        else if (b.type === 'thinking' && b.thinking) a.parts.push({ type: 'thinking', text: b.thinking });
        else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
          const part = { type: 'tool' as const, id: b.id, name: b.name, input: b.input };
          tools.set(b.id, part);
          a.parts.push(part);
        } else if (b.type === 'web_search_tool_result') {
          const part = tools.get(b.tool_use_id);
          if (part) part.result = Array.isArray(b.content) ? `${b.content.length} 条结果` : '搜索失败';
        }
      }
    }
  }
  return items;
}

export function toolLabel(name: string, input: any): string {
  const i = input ?? {};
  switch (name) {
    case 'set_trip_info':
      return '更新行程信息';
    case 'set_day_count':
      return `设为 ${i.count ?? ''} 天`;
    case 'update_day':
      return `更新第 ${i.day ?? ''} 天${i.title ? `「${i.title}」` : ''}`;
    case 'add_places':
      return `添加 ${Array.isArray(i.places) ? i.places.length : ''} 个地点到第 ${i.day ?? ''} 天`;
    case 'update_place':
      return `修改地点${i.name ? `「${i.name}」` : ''}`;
    case 'remove_places':
      return `删除 ${Array.isArray(i.place_ids) ? i.place_ids.length : ''} 个地点`;
    case 'move_place':
      return `移动地点到第 ${i.to_day ?? ''} 天`;
    case 'reorder_day':
      return `调整第 ${i.day ?? ''} 天的顺序`;
    case 'optimize_day_route':
      return `优化第 ${i.day ?? ''} 天的路线`;
    case 'remove_day':
      return `删除第 ${i.day ?? ''} 天`;
    case 'geocode':
      return `查找「${i.query ?? ''}」`;
    case 'web_search':
      return `联网搜索「${i.query ?? ''}」`;
    default:
      return name;
  }
}
