// The application's roles.
//
// There is no roles table — app.account.role_id is a free nvarchar(50) — so this
// list IS the definition. It lives on the backend and is served to the UI via
// GET /uiapi/users/roles so the dropdown and the validation cannot drift apart.
// Keep the ids in step with the Role union in frontend/src/composables/useAccess.ts,
// which decides what each role can actually see.

export interface RoleDef {
  id: string;
  label: string;
  description: string;
}

export const ROLES: RoleDef[] = [
  {
    id: 'dev',
    label: 'Developer',
    description:
      'Full access, including destructive operations such as rolling back a data import.',
  },
  {
    id: 'admin',
    label: 'Admin',
    description:
      'Admin surfaces — prompts, AI models, system health, data import — plus user management.',
  },
  {
    id: 'supervisor',
    label: 'Supervisor',
    description:
      'Dashboards and CSAT assessment. Can read prompts but not change them, and cannot import data.',
  },
  {
    id: 'user',
    label: 'User',
    description: 'Standard access to the dashboards. No admin surfaces.',
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Limited access, intended for contact-centre agents.',
  },
  {
    id: 'client',
    label: 'Client',
    description:
      'External client access — Operations, Client Services, Survey Insights and ' +
      'Narratives only, scoped to their own client’s data. Requires a client ' +
      'assignment.',
  },
];

export const ROLE_IDS = ROLES.map((r) => r.id);

export function isKnownRole(roleId: string | null | undefined): boolean {
  return !!roleId && ROLE_IDS.includes(roleId.trim().toLowerCase());
}

/** Normalises to the canonical lower-case id, or null when unrecognised. */
export function normaliseRole(roleId: string | null | undefined): string | null {
  const v = (roleId ?? '').trim().toLowerCase();
  return ROLE_IDS.includes(v) ? v : null;
}
