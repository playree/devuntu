import { DashboardLayout } from '@/lib/schema/schema-dashboard'

export const WidgetDefaultLayout: DashboardLayout = {
  left: ['my_tickets', 'mentions', 'due_soon', null, null, null, null, null, null, null],
  right: ['announcement', 'app_info', 'release_Note', null, null, null, null, null, null, null],
} as const
