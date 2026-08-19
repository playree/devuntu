import { el } from '@/locale'
import { z } from 'zod'
import { NOTIFY_EVENTS } from './notify'
import {
  ASSIGNEE_NONE,
  BOARD_KEY_PATTERN,
  isReservedBoardKey,
  MAX_BOARD_KEY,
  MAX_TAG_NAME,
  MAX_TICKET_TAGS,
  TAG_COLORS,
  TICKET_PRIORITIES,
  TICKET_SORT_COLUMNS,
  TICKET_STATUSES,
} from './task'

export const zName = z.string().min(2, el('@invalid_name')).max(30, el('@invalid_name'))
export const zEmail = z.email(el('@invalid_email'))
/**
 * パスワード。パスフレーズやパスワードマネージャの生成値を弾かないよう、文字種は制限せず長さだけを見る。
 * 上限は better-auth の maxPasswordLength(既定 128)に合わせる。
 */
export const zPassword = z.string().min(8, el('@invalid_password')).max(128, el('@invalid_password'))
export const zDescription = z.string().max(40, el('@invalid_description')).optional()

/** アップロード画像の上限。クライアント側の入力チェックにも使うので export する */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const zImageFile = z
  .instanceof(File, { message: el('@required_field') })
  .refine((file) => file.size <= MAX_IMAGE_SIZE, el('@invalid_image_size'))
  .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file.type), el('@invalid_image_type'))

export const scUUID = z.object({
  id: z.uuidv7(),
})

export const scSignInUsername = z.object({
  username: zEmail,
})
export type SignInUsername = z.infer<typeof scSignInUsername>

export const scSignInPassword = z.object({
  password: z.string(),
})
export type SignInPassword = z.infer<typeof scSignInPassword>

export const scOtp = z.object({
  otp: z.string(),
})
export type Otp = z.infer<typeof scOtp>

export const scTwoFaCode = z.object({
  otp: z.string(),
  trustDevice: z.boolean(),
})
export type TwoFaCode = z.infer<typeof scTwoFaCode>

export const scCreateAdmin = z.object({
  name: zName,
  email: zEmail,
  password: zPassword.optional(),
})
export type CreateAdmin = z.infer<typeof scCreateAdmin>

export const scInputEmail = z.object({
  email: zEmail,
})
export type InputEmail = z.infer<typeof scInputEmail>

export const scSetPassword = z.object({
  password: zPassword,
})
export type SetPassword = z.infer<typeof scSetPassword>

export const scAddOidcClient = z.object({
  clientName: z.string(),
  redirectUri: z.url(),
  skipConsent: z.boolean(),
  requirePkce: z.boolean(),
})
export type AddOidcClient = z.infer<typeof scAddOidcClient>

export const scUpdateOidcClient = z.object({
  clientId: z.string(),
  clientName: z.string(),
  redirectUri: z.url(),
  skipConsent: z.boolean(),
})
export type UpdateOidcClient = z.infer<typeof scUpdateOidcClient>

export const scDeleteOidcClient = z.object({
  clientId: z.string(),
})

export const scConsent = z.object({
  accept: z.boolean(),
  oauthQuery: z.string().min(1),
})
export type Consent = z.infer<typeof scConsent>

export const scRevokeConsent = z.object({
  id: z.uuidv7(),
})

export const scCreateUser = z.object({
  name: zName,
  email: zEmail,
  password: zPassword.optional(),
  isAdmin: z.boolean(),
  groups: z.array(z.uuidv7()).default([]),
})
export type CreateUser = z.infer<typeof scCreateUser>
export type CreateUserIn = z.input<typeof scCreateUser>
export type CreateUserOut = z.output<typeof scCreateUser>

export const scUpdateUser = z.object({
  id: z.uuidv7(),
  name: zName,
  email: zEmail,
  isAdmin: z.boolean(),
  groups: z.array(z.uuidv7()),
})
export type UpdateUser = z.infer<typeof scUpdateUser>

export const scUpdatePasskey = z.object({
  id: z.uuidv7(),
  name: z.string(),
})
export type UpdatePasskey = z.infer<typeof scUpdatePasskey>

export const scDashboardLayout = z.object({
  left: z.array(z.string().nullable()),
  right: z.array(z.string().nullable()),
})
export type DashboardLayout = z.infer<typeof scDashboardLayout>

export const scUpdateDashboard = z.object({
  layout: scDashboardLayout,
})

export const scUpdateAnnouncement = z.object({
  body: z.string(),
})
export type UpdateAnnouncement = z.infer<typeof scUpdateAnnouncement>

export const scCreateLinkWidget = z.object({
  name: zName,
  url: z.url(),
  description: zDescription,
  icon: zImageFile.optional(),
})
export type CreateLinkWidget = z.infer<typeof scCreateLinkWidget>

export const scUpdateLinkWidget = z.object({
  id: z.uuidv7(),
  name: zName,
  url: z.url(),
  description: zDescription,
  icon: zImageFile.nullish(), // File | null | undefined
})
export type UpdateLinkWidget = z.infer<typeof scUpdateLinkWidget>

export const scCreateGroup = z.object({
  name: zName,
  description: zDescription.optional(),
})
export type CreateGroup = z.infer<typeof scCreateGroup>

export const scUpdateGroup = z.object({
  id: z.uuidv7(),
  name: zName,
  description: zDescription.optional(),
})
export type UpdateGroup = z.infer<typeof scUpdateGroup>

export const zShareTitle = z.string().trim().max(50) // 空文字許可(表示側でフォールバック)

/** CalendarShare.options の構造 */
export const scCalendarShareOptions = z.object({ title: z.string().max(50).optional() })
export type CalendarShareOptions = z.infer<typeof scCalendarShareOptions>

export const scUpdateCalendarShareTitle = z.object({ title: zShareTitle })
export type UpdateCalendarShareTitle = z.infer<typeof scUpdateCalendarShareTitle>

/** 追加Busy時間(件名+曜日+時間帯)。時間は 0:00 からの分(30分刻み)で扱う */
const zMin30 = z.number().int().multipleOf(30, el('@invalid_time_range'))
// InputCtrl の constraintSchema(z.ZodObject 前提)へ渡すため refine 前の base を分離
export const scBusyTimeBase = z.object({
  title: z.string().trim().min(1, el('@required_field')).max(50),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, el('@select_weekday')),
  startMin: zMin30.min(0, el('@invalid_time_range')).max(1410, el('@invalid_time_range')),
  endMin: zMin30.min(30, el('@invalid_time_range')).max(1440, el('@invalid_time_range')),
})
export const scBusyTimeFields = scBusyTimeBase.refine((d) => d.startMin < d.endMin, {
  path: ['endMin'],
  message: el('@invalid_time_range'),
})

export const scCreateBusyTime = scBusyTimeFields
export type CreateBusyTime = z.infer<typeof scCreateBusyTime>

export const scUpdateBusyTime = z.object({ id: z.uuidv7() }).and(scBusyTimeFields)
export type UpdateBusyTime = z.infer<typeof scUpdateBusyTime>

/** 外部サービス連携設定(Google / Slack で共通) */
export const scUpdateIntegrationSettings = z.object({
  enabled: z.boolean(),
  allowedGroupIds: z.array(z.uuidv7()),
})
export type UpdateIntegrationSettings = z.infer<typeof scUpdateIntegrationSettings>

/**
 * 通知設定(イベント種別ごと・チャネルごとの ON/OFF)。種別が増えても z.enum が自動で追従する。
 * チャネルは常に全部まとめて受け取り、サーバー側に部分更新の分岐を作らない。
 */
export const scUpdateNotifySetting = z.object({
  event: z.enum(NOTIFY_EVENTS),
  email: z.boolean(),
  slack: z.boolean(),
})
export type UpdateNotifySetting = z.infer<typeof scUpdateNotifySetting>

/* -------------------------------------------------------------------------------------------------
 * タスク管理(チケット / ボード)
 * InputCtrl の constraintSchema は z.ZodObject を要求するため、
 * `.refine()` / `.and()` は使わず `z.object` / `.extend()` / `.omit()` で組み立てる。
 * -----------------------------------------------------------------------------------------------*/

export const zTicketTitle = z.string().trim().min(1, el('@required_field')).max(120, el('@invalid_title'))
export const zTicketContent = z.string().max(20000, el('@invalid_content'))

/** タグ名。表示用の文字列。検索条件でも使う */
export const zTagName = z.string().trim().min(1, el('@invalid_tag')).max(MAX_TAG_NAME, el('@invalid_tag'))
/** タグの色。TAG_COLORS(task.ts) を単一ソースにする */
export const zTagColor = z.enum(TAG_COLORS)
/** タグの表示順 */
export const zTagOrder = z.number().int().min(0).max(999)
/** チケットへ付けるタグ。名前配列との取り違えを型で防ぐためフィールド名も tagIds にする */
export const zTagIds = z.array(z.uuidv7()).max(MAX_TICKET_TAGS, el('@invalid_tag'))

/** ステータス / 優先度 / ロールは task.ts を単一ソースにする(Prisma の enum とはそちらで突き合わせる) */
export const zTicketStatus = z.enum(TICKET_STATUSES)
export const zTicketPriority = z.enum(TICKET_PRIORITIES)
export const zCommentContent = z.string().trim().min(1, el('@required_field')).max(5000, el('@invalid_content'))
export const zBoardDescription = z.string().max(200, el('@invalid_description')).optional()
/**
 * ボードキー(チケット表示ID `KEY-番号` の接頭辞)。小文字で入力されても大文字へ寄せてから検証する。
 * 変更すると共有済みの表示IDが解決できなくなるため、変更できるのは owner と管理者に限る。
 * プライベートボードの採番領域(PRV)は `isReservedBoardKey` で塞ぐ。
 */
export const zBoardKey = z
  .string()
  .trim()
  .toUpperCase()
  .max(MAX_BOARD_KEY, el('@invalid_board_key'))
  .regex(BOARD_KEY_PATTERN, el('@invalid_board_key'))
  .refine((key) => !isReservedBoardKey(key), el('@reserved_board_key'))
/** ボードのロール。Prisma の BoardMemberRole / task.ts の BoardRole と一致させる */
export const zBoardRole = z.enum(['owner', 'member'])

/** 期日は日付のみ(YYYY-MM-DD)。DatePickerCtrl が CalendarDate との変換を担う */
export const zDueDate = z.iso.date().nullish()

export const scCreateTicket = z.object({
  // プライベートも必ずボードに属するため必須。既定値はプライベートボード
  boardId: z.uuidv7(),
  title: zTicketTitle,
  content: zTicketContent.optional(),
  status: zTicketStatus.default('todo'),
  // 必須。未指定は medium(クリア不可のため UI からは null が飛ばない)
  priority: zTicketPriority.default('medium'),
  dueDate: zDueDate,
  tagIds: zTagIds.default([]),
  assigneeId: z.uuidv7().nullish(),
})
export type CreateTicket = z.infer<typeof scCreateTicket>
export type CreateTicketIn = z.input<typeof scCreateTicket>
export type CreateTicketOut = z.output<typeof scCreateTicket>

/**
 * チケットの部分更新(詳細画面のインライン編集)。
 *
 * 渡された項目だけを更新する。status はレーン順の再採番を伴うため scUpdateTicketStatus 側で扱う。
 * z.object で組むので constraintSchema へも渡せる(.optional() は getFieldConstraints が剥がす)。
 */
export const scPatchTicket = z.object({
  id: z.uuidv7(),
  title: zTicketTitle.optional(),
  content: zTicketContent.optional(),
  priority: zTicketPriority.optional(),
  /** undefined = 変更しない / null = クリア(zDueDate は nullish) */
  dueDate: zDueDate,
  tagIds: zTagIds.optional(),
  /** undefined = 変更しない / null = 未割り当てへ */
  assigneeId: z.uuidv7().nullish(),
})
export type PatchTicket = z.infer<typeof scPatchTicket>
export type PatchTicketIn = z.input<typeof scPatchTicket>

export const scUpdateTicketStatus = z.object({
  id: z.uuidv7(),
  status: zTicketStatus,
})
export type UpdateTicketStatus = z.infer<typeof scUpdateTicketStatus>

export const scMoveTicket = z.object({
  id: z.uuidv7(),
  status: zTicketStatus,
  /** 移動先レーン内の 0 始まりの挿入位置 */
  index: z.number().int().min(0),
})
export type MoveTicket = z.infer<typeof scMoveTicket>

export const scTicketSearch = z.object({
  keyword: z.string().trim().max(100).default(''),
  status: z.array(zTicketStatus).default([]),
  priority: z.array(zTicketPriority).default([]),
  /** タグは名前で絞り込む。ボード横断時に同名タグが分裂しないようにするため */
  tags: z.array(zTagName).max(MAX_TICKET_TAGS).default([]),
  /** null = 可視ボード全体。プライベートも 1 つのボードとして指定する */
  boardId: z.uuidv7().nullish(),
  /** null = すべて / 'none' = 未割り当て / それ以外は userId(KanbanFilter.assignee と同じ規約) */
  assignee: z.union([z.literal(ASSIGNEE_NONE), z.uuidv7()]).nullish(),
})
export type TicketSearch = z.infer<typeof scTicketSearch>
export type TicketSearchIn = z.input<typeof scTicketSearch>

/** 一覧のソート対象列。TICKET_SORT_COLUMNS(task.ts) を単一ソースにする */
export const zTicketSortColumn = z.enum(TICKET_SORT_COLUMNS)

export const zSortDirection = z.enum(['ascending', 'descending'])
export type SortDirection = z.infer<typeof zSortDirection>

/**
 * チケット一覧の問い合わせ条件。検索条件にページングと並び順を足したもの。
 *
 * 検索パネルは scTicketSearch だけを扱うため、ページング項目は別スキーマとして分けている。
 *
 * 並び順はテーブルのヘッダ操作(HeroUI の SortDescriptor)由来の任意の文字列として渡ってくるので、
 * string を受けてから列名へ絞り、想定外の値はエラーにせず既定へ落として一覧が壊れないようにする。
 */
export const scTicketListQuery = scTicketSearch.extend({
  page: z.number().int().min(1).default(1),
  // 上限は ROWS_PER_PAGE_OPTIONS(components/general/paging.ts)の最大値に合わせる
  rowsPerPage: z.number().int().min(1).max(100).default(10),
  sortColumn: z.string().default('updatedAt').pipe(zTicketSortColumn.catch('updatedAt')),
  sortDirection: z.string().default('descending').pipe(zSortDirection.catch('descending')),
})
export type TicketListQuery = z.infer<typeof scTicketListQuery>
export type TicketListQueryIn = z.input<typeof scTicketListQuery>

export const scCreateTicketComment = z.object({
  ticketId: z.uuidv7(),
  content: zCommentContent,
})
export type CreateTicketComment = z.infer<typeof scCreateTicketComment>

export const scUpdateTicketComment = z.object({
  id: z.uuidv7(),
  content: zCommentContent,
})
export type UpdateTicketComment = z.infer<typeof scUpdateTicketComment>

export const scCreateBoard = z.object({
  name: zName,
  key: zBoardKey,
  description: zBoardDescription,
})
export type CreateBoard = z.infer<typeof scCreateBoard>

export const scUpdateBoard = z.object({
  id: z.uuidv7(),
  name: zName,
  key: zBoardKey,
  description: zBoardDescription,
})
export type UpdateBoard = z.infer<typeof scUpdateBoard>

/**
 * アーカイブの切り替え。プロフィール編集と経路を分けることで、
 * アーカイブ操作が画面に残っている古い name / key を書き戻さないようにする。
 */
export const scSetBoardArchived = z.object({
  id: z.uuidv7(),
  archived: z.boolean(),
})
export type SetBoardArchived = z.infer<typeof scSetBoardArchived>

/**
 * ユーザー単位のアサインをメンバー 1 人ずつ追加 / 変更する(owner も実行可能)。
 * グループ経由ユーザーへの直接ロール付与も同じ入力で表せる。
 * `id` はボード ID、`userId` が対象ユーザー。
 */
export const scUpsertBoardMember = z.object({
  id: z.uuidv7(),
  // 未選択(空文字)のままの送信をフォーム側でも弾けるようメッセージを付ける
  userId: z.uuidv7(el('@required_field')),
  role: zBoardRole,
})
export type UpsertBoardMember = z.infer<typeof scUpsertBoardMember>
export type UpsertBoardMemberIn = z.input<typeof scUpsertBoardMember>

/** 直接メンバー(BoardMember 行)の解除。グループ経由メンバーには使えない */
export const scRemoveBoardMember = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
})
export type RemoveBoardMember = z.infer<typeof scRemoveBoardMember>

/** グループ単位のアサイン(管理者のみ)。権限境界が違うためユーザー単位と分けている */
export const scSetBoardGroups = z.object({
  id: z.uuidv7(),
  groupIds: z.array(z.uuidv7()).default([]),
})
export type SetBoardGroups = z.infer<typeof scSetBoardGroups>
export type SetBoardGroupsIn = z.input<typeof scSetBoardGroups>

/* -------------------------------------------------------------------------------------------------
 * タグ
 * -----------------------------------------------------------------------------------------------*/

/** タグはボードに属する。プライベートタグもプライベートボードの boardId を指定する */
export const scCreateTag = z.object({
  boardId: z.uuidv7(),
  name: zTagName,
  color: zTagColor.default('gray'),
  /** 未指定は末尾へ採番する。0 を明示した場合は 0 のまま扱うため既定値は持たせない */
  order: zTagOrder.optional(),
})
export type CreateTag = z.infer<typeof scCreateTag>
export type CreateTagIn = z.input<typeof scCreateTag>
export type CreateTagOut = z.output<typeof scCreateTag>

export const scUpdateTag = z.object({
  id: z.uuidv7(),
  name: zTagName,
  color: zTagColor,
  order: zTagOrder,
})
export type UpdateTag = z.infer<typeof scUpdateTag>
export type UpdateTagIn = z.input<typeof scUpdateTag>
export type UpdateTagOut = z.output<typeof scUpdateTag>
