'use client'

import { createEnumChip } from '@/components/enum-chip'
import type { BoardNoteKind, BoardNoteType } from '@/generated/prisma/enums'

export const boardNoteKindChip = createEnumChip<BoardNoteKind>({
  knowledge: { item: 'board_note_kind_knowledge', color: 'accent' },
  memory: { item: 'board_note_kind_memory', color: 'default' },
})
export const BoardNoteKindChip = boardNoteKindChip.EnumChip

export const boardNoteTypeChip = createEnumChip<BoardNoteType>({
  convention: { item: 'board_note_type_convention', color: 'accent' },
  decision: { item: 'board_note_type_decision', color: 'success' },
  insight: { item: 'board_note_type_insight', color: 'warning' },
  reference: { item: 'board_note_type_reference', color: 'default' },
})
export const BoardNoteTypeChip = boardNoteTypeChip.EnumChip
