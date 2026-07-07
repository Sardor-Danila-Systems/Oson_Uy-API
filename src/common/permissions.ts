import { ProjectMemberRole } from '@prisma/client';

/**
 * Каталог прав рабочей области проекта. Ключ → человекочитаемое название.
 * Используется и на бэкенде (гард), и на фронте (шапка навигации, матрица прав).
 */
export const PERMISSION_KEYS = [
  'chessboard', // Шахматка и бронирование
  'customers', // Клиенты (CRM)
  'contracts', // Договоры: создание и редактирование
  'payments', // Приём оплат по договорам
  'finance', // Финансы: кассы, расходы, переводы, задолженности
  'reports', // Отчёты и аналитика
  'scene3d', // 3D-модель
  'team', // Команда, роли и права
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  chessboard: 'Шахматка и бронирование',
  customers: 'Клиенты (CRM)',
  contracts: 'Договоры: создание и редактирование',
  payments: 'Приём оплат',
  finance: 'Финансы: кассы, расходы, задолженности',
  reports: 'Отчёты и аналитика',
  scene3d: '3D-модель',
  team: 'Команда, роли и права',
};

export const ROLE_LABELS: Record<ProjectMemberRole, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  MANAGER: 'Менеджер',
  SALES: 'Отдел продаж',
};

type PermMap = Record<PermissionKey, boolean>;

const ALL_TRUE = (): PermMap =>
  PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {} as PermMap);

const build = (on: PermissionKey[]): PermMap =>
  PERMISSION_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: on.includes(k) }),
    {} as PermMap,
  );

/** Права по умолчанию для каждой роли. */
export const ROLE_DEFAULTS: Record<ProjectMemberRole, PermMap> = {
  OWNER: ALL_TRUE(),
  ADMIN: ALL_TRUE(),
  MANAGER: build([
    'chessboard',
    'customers',
    'contracts',
    'payments',
    'reports',
    'scene3d',
  ]),
  SALES: build(['chessboard', 'customers', 'contracts', 'payments']),
};

/**
 * Итоговые права участника: дефолты роли + индивидуальные переопределения.
 * OWNER/ADMIN всегда имеют полный доступ (переопределения не могут их урезать).
 */
export function resolvePermissions(
  role: ProjectMemberRole,
  overrides?: unknown,
): PermMap {
  if (role === 'OWNER' || role === 'ADMIN') return ALL_TRUE();
  const base = { ...ROLE_DEFAULTS[role] };
  if (overrides && typeof overrides === 'object') {
    for (const k of PERMISSION_KEYS) {
      const v = (overrides as Record<string, unknown>)[k];
      if (typeof v === 'boolean') base[k] = v;
    }
  }
  return base;
}

export function can(
  role: ProjectMemberRole,
  overrides: unknown,
  key: PermissionKey,
): boolean {
  return resolvePermissions(role, overrides)[key];
}
