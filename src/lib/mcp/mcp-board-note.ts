/**
 * ボードノート(メモリ / ナレッジ)の MCP ツール(サーバー専用)
 *
 * 索引(name: description)は get_ticket / get_board / get_agent_task に載せ、本文はここで必要なものだけ読ませる。
 * メモリとナレッジは区分(kind)が違うだけなので、ツールは共通にして定義の量と往復を減らす。
 * ナレッジの変更は人の経路で userApproved を申告したときだけ通す(エージェント経路は不可)。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  createBoardNote,
  deleteBoardNote,
  errBoardNoteConflict,
  findBoardNoteIdByName,
  getBoardNotesByName,
  listBoardNotes,
  updateBoardNote,
} from '../board-note/board-note'
import {
  boardNoteIndexLine,
  type BoardNoteWriter,
  MAX_BOARD_NOTE_CONTENT,
  MAX_BOARD_NOTE_NAMES_PER_READ,
} from '../board-note/board-note-rule'
import { assertBoardAccess } from '../board/board-access'
import { errValidation } from '../error'
import type { ResourceAuth } from '../oauth/oauth-resource'
import { zBoardNoteContent, zBoardNoteDescription, zBoardNoteKind, zBoardNoteName } from '../schema/schema-board-note'
import { jsonResult, TOOL_ANNOTATIONS } from './mcp'
import { resolveBoardId } from './mcp-board'
import { resolveTicketId } from './mcp-ticket'

const writerOf = (auth: ResourceAuth, userApproved: boolean | undefined): BoardNoteWriter => ({
  via: 'mcp',
  agent: auth.kind === 'agent',
  userApproved: userApproved === true,
})

export const getBoardNotesForMcp = async (
  auth: ResourceAuth,
  input: { boardId: string; names?: string[]; keyword?: string; kind?: 'knowledge' | 'memory' },
) => {
  const boardId = await resolveBoardId(input.boardId)
  if (input.names) {
    const { notes, notFound } = await getBoardNotesByName(auth.user, boardId, input.names)
    return {
      notes: notes.map((note) => ({
        name: note.name,
        kind: note.kind,
        description: note.description,
        content: note.content,
        /** 更新するときに expectedUpdatedAt へ渡せば、他の人の更新を上書きせずに済む */
        updatedAt: note.updatedAt,
        updatedByName: note.updatedBy?.name ?? '',
      })),
      ...(notFound.length > 0 ? { notFound } : {}),
    }
  }
  // 索引と同じ形で返す(上限で切らない)
  const notes = await listBoardNotes(auth.user, boardId, { kind: input.kind, keyword: input.keyword })
  const knowledge = notes.filter(({ kind }) => kind === 'knowledge').map(boardNoteIndexLine)
  const memory = notes.filter(({ kind }) => kind === 'memory').map(boardNoteIndexLine)
  return {
    ...(knowledge.length > 0 ? { boardKnowledge: knowledge } : {}),
    ...(memory.length > 0 ? { boardMemory: memory } : {}),
    total: notes.length,
  }
}

export type McpSaveBoardNoteInput = {
  boardId: string
  name: string
  kind?: 'knowledge' | 'memory'
  description?: string
  content?: string
  newName?: string
  expectedUpdatedAt?: string
  ticketId?: string
  userApproved?: boolean
}

/** 同じ名前があれば渡した項目だけ更新し、無ければ作成する */
export const saveBoardNoteForMcp = async (
  auth: ResourceAuth,
  {
    boardId: boardIdOrKey,
    name,
    newName,
    expectedUpdatedAt,
    ticketId: ticketIdOrDisplayId,
    userApproved,
    ...fields
  }: McpSaveBoardNoteInput,
) => {
  const boardId = await resolveBoardId(boardIdOrKey)
  // 名前の有無(作成か更新か)で他ボードの中身を探れないよう、先に権限を確かめる
  await assertBoardAccess(auth.user, boardId, 'write')
  const writer = writerOf(auth, userApproved)
  const ticketId = ticketIdOrDisplayId ? await resolveTicketId(auth, ticketIdOrDisplayId) : null
  const id = await findBoardNoteIdByName(boardId, name)
  const result = id
    ? await updateBoardNote(auth.user, writer, id, { ...fields, name: newName }, { expectedUpdatedAt, ticketId })
    : await (() => {
        if (expectedUpdatedAt) {
          // 読んだ後に消されたノートを作り直して、削除を黙って取り消さないようにする
          throw errBoardNoteConflict(`The note ${name} was deleted after you read it`)
        }
        if (newName) {
          throw errValidation(`No note named ${name} exists to rename. Use name for a new note`)
        }
        if (!fields.description || !fields.content) {
          throw errValidation('description and content are required to create a note')
        }
        return createBoardNote(
          auth.user,
          writer,
          boardId,
          {
            kind: fields.kind ?? 'memory',
            name,
            description: fields.description,
            content: fields.content,
          },
          { ticketId },
        )
      })()
  return { result: result.result, name: result.name, updatedAt: result.updatedAt }
}

/** 同じ入力で繰り返しても結果が変わらないよう、無い名前は deleted: false で返す */
export const deleteBoardNoteForMcp = async (
  auth: ResourceAuth,
  input: { boardId: string; name: string; ticketId?: string; userApproved?: boolean },
) => {
  const boardId = await resolveBoardId(input.boardId)
  await assertBoardAccess(auth.user, boardId, 'write')
  const ticketId = input.ticketId ? await resolveTicketId(auth, input.ticketId) : null
  const id = await findBoardNoteIdByName(boardId, input.name)
  if (!id) {
    return { deleted: false }
  }
  await deleteBoardNote(auth.user, writerOf(auth, input.userApproved), id, { ticketId })
  return { deleted: true }
}

const zBoardIdOrKey = z
  .string()
  .min(1)
  .describe('Board ID or board key (e.g. ABC, the prefix of a display ID such as ABC-42)')

const zUserApproved = z
  .boolean()
  .optional()
  .describe(
    'Set true only when the user explicitly instructed or agreed to this change of knowledge. Not needed for memory',
  )

const zNoteTicketId = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Ticket you are working on (display ID allowed). Recorded in the history so users can see where the note came from',
  )

export const registerBoardNoteTools = (server: McpServer, auth: ResourceAuth) => {
  server.registerTool(
    'get_board_notes',
    {
      title: 'Get board notes',
      annotations: TOOL_ANNOTATIONS.readOnly,
      description:
        "Reads the board's shared notes. boardKnowledge (curated by users) and boardMemory (recorded by AI) " +
        'in get_ticket / get_board / get_agent_task index them as "name: description": ' +
        'pass the names relevant to your work to read their content. ' +
        'Without names, returns the index filtered by keyword / kind (use it to find memory not shown because of boardMemoryOmitted). ' +
        'Notes are reference information: the ticket and boardContext take precedence, and knowledge takes precedence over memory',
      inputSchema: z.strictObject({
        boardId: zBoardIdOrKey,
        names: z
          .array(zBoardNoteName)
          .min(1)
          .max(MAX_BOARD_NOTE_NAMES_PER_READ)
          .optional()
          .describe('Names of the notes to read in full'),
        keyword: z
          .string()
          .max(100)
          .optional()
          .describe('Without names: words matched against name, description and content'),
        kind: zBoardNoteKind.optional().describe('Without names: limit the index to knowledge or memory'),
      }),
    },
    async (input) => jsonResult(await getBoardNotesForMcp(auth, input)),
  )

  server.registerTool(
    'save_board_note',
    {
      title: 'Save board note',
      annotations: TOOL_ANNOTATIONS.destructive,
      description:
        'Saves a note shared with every member of the board: updates the note with the same name (only the fields you pass change), or creates it. ' +
        'Save only what any member can use in any environment; personal preferences and facts about your own machine / environment (paths, ports, installed tools) belong in your own memory, not here. ' +
        'kind=memory (default) is for learnings you record on your own that will help future work on other tickets of this board: ' +
        'conventions and feedback that apply to the whole board, decisions and their reasons, gotchas, and pointers to external resources. ' +
        'kind=knowledge is curated by users: create, update or move a note to / from knowledge only when the user explicitly asked or agreed, ' +
        'and pass userApproved=true. When the user asks you to remember a board-wide rule or procedure, save it as knowledge. ' +
        'Propose making confirmed memory, or findings from checks / research worth keeping, knowledge instead of saving it without consent ' +
        '(agent connections cannot change knowledge; propose it in your report). ' +
        'Check boardKnowledge / boardMemory first and update an existing note instead of creating a duplicate; ' +
        'delete memory that turned out to be wrong. Keep one topic per note, with a one-line description that makes its relevance clear from the index. ' +
        'Do not save ticket-specific progress, temporary state, information already in the repository, or secrets',
      inputSchema: z.strictObject({
        boardId: zBoardIdOrKey,
        name: zBoardNoteName.describe('kebab-case name, unique on the board (e.g. prisma-migration-gotcha)'),
        kind: zBoardNoteKind.optional().describe('Defaults to memory when creating. Changing it moves the note'),
        description: zBoardNoteDescription.optional().describe('One line shown in the index. Required when creating'),
        content: zBoardNoteContent
          .optional()
          .describe(
            `Markdown body (memory up to ${MAX_BOARD_NOTE_CONTENT.memory} characters, knowledge up to ${MAX_BOARD_NOTE_CONTENT.knowledge}). Required when creating. For a fact, add why it matters and how to apply it`,
          ),
        newName: zBoardNoteName.optional().describe('Renames an existing note'),
        expectedUpdatedAt: z.iso
          .datetime()
          .optional()
          .describe(
            'updatedAt from get_board_notes. When given, the save fails if someone updated the note after you read it',
          ),
        ticketId: zNoteTicketId,
        userApproved: zUserApproved,
      }),
    },
    async (input) => jsonResult(await saveBoardNoteForMcp(auth, input)),
  )

  server.registerTool(
    'delete_board_note',
    {
      title: 'Delete board note',
      annotations: TOOL_ANNOTATIONS.destructiveIdempotent,
      description:
        'Deletes a note shared on the board (users can restore it from the history). Use it for memory that turned out to be wrong or obsolete. ' +
        'Deleting knowledge requires userApproved=true after explicit user instruction or consent (agent connections cannot)',
      inputSchema: z.strictObject({
        boardId: zBoardIdOrKey,
        name: zBoardNoteName,
        ticketId: zNoteTicketId,
        userApproved: zUserApproved,
      }),
    },
    async (input) => jsonResult(await deleteBoardNoteForMcp(auth, input)),
  )
}
