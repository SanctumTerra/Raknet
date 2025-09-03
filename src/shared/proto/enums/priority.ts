export const Priority = { Medium: 0, High: 1 } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];
