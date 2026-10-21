'use client'

import { createEnumChip } from '@/components/enum-chip'
import type { BoardNoteKind } from '@/generated/prisma/enums'

export const boardNoteKindChip = createEnumChip<BoardNoteKind>({
  knowledge: { item: 'board_note_kind_knowledge', color: 'accent' },
  memory: { item: 'board_note_kind_memory', color: 'default' },
})
export const BoardNoteKindChip = boardNoteKindChip.EnumChip
