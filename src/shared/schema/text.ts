// Project text permits tab/newline and DEL; do not substitute the stricter kit policy.
export const FORBIDDEN_TEXT_CONTROL_RANGE = '\\u0000-\\u0008\\u000b-\\u001f';
const forbiddenControl = new RegExp(`[${FORBIDDEN_TEXT_CONTROL_RANGE}]`);

export function hasForbiddenControl(value: string): boolean {
  return forbiddenControl.test(value);
}
