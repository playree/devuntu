export type WidgetDefine = {
  id: string
  requiredAdmin: boolean
}

export const AppInfoWD: WidgetDefine = { id: 'app_info', requiredAdmin: false } as const

export const widgetList: WidgetDefine[] = [AppInfoWD] as const
