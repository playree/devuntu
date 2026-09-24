import { DashboardLayout } from '@/lib/schema/schema'

export const WidgetDefaultLayout: DashboardLayout = {
  left: ['my_tickets', 'app_info', 'server_info', null, null, null, null, null, null, null],
  right: ['release_Note', null, null, null, null, null, null, null, null, null],
} as const
