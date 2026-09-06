/** Demo single-locale JSON: keys are stored as-is (no module prefix split). */
export const DEMO_JSON_TEMPLATE: Record<string, string> = {
  'common.save': 'Lưu',
  hello: 'Xin chào',
}

export function demoJsonText(): string {
  return `${JSON.stringify(DEMO_JSON_TEMPLATE, null, 2)}\n`
}

export function demoJsonFilename(baseLanguage: string): string {
  return `${baseLanguage}.json`
}
