'use client'

import { TemplateListEditor } from '@/components/template-list-editor'
import { WikiPageTypeChip } from '@/components/wiki-chip'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { MAX_WIKI_TEMPLATES_PER_SPACE } from '@/lib/wiki/wiki-template-rule'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import type { WikiSpaceContextValue } from '../space-context'
import { deleteWikiTemplate, getWikiTemplates, moveWikiTemplate } from './server'
import { WikiTemplateModal } from './wiki-template-modal'

/** スペースのページテンプレート(owner または管理者)。アーカイブ済みのスペースでは変更できない */
export const WikiSpaceTemplates: FC<{ space: WikiSpaceContextValue['space'] }> = ({ space }) => {
  const { t } = useLocale()
  const { data: templates, refresh } = useActionData(() => getWikiTemplates({ id: space.id }), { key: space.id })

  if (space.archived) {
    return <p className='text-muted text-sm'>{t('msg_wiki_space_archived')}</p>
  }

  return (
    <TemplateListEditor
      templates={templates ?? []}
      description={t('msg_wiki_template_desc')}
      limit={MAX_WIKI_TEMPLATES_PER_SPACE}
      canManage
      onDelete={(id) => parseAction(deleteWikiTemplate({ id }))}
      onMove={(id, direction) => parseAction(moveWikiTemplate({ id, direction }))}
      reload={refresh}
      renderBadge={(template) => <WikiPageTypeChip value={template.type} />}
      renderDetails={(template) => <div className='text-muted truncate text-xs'>{template.title || '-'}</div>}
      renderModal={(state) => <WikiTemplateModal state={state} space={space} reload={refresh} />}
    />
  )
}
