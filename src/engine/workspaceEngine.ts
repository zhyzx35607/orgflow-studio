import {
  DepartmentNode,
  KnowledgeDocCard,
  ResourcePermission,
  WorkspaceMember,
  WorkspaceRole,
} from '../types/domain';

export function buildDepartmentTree(departments: DepartmentNode[]): DepartmentNode[] {
  const map = new Map<string, DepartmentNode>();
  for (const dept of departments) {
    map.set(dept.id, { ...dept, children: [] });
  }

  const roots: DepartmentNode[] = [];
  for (const dept of map.values()) {
    if (dept.parentId && map.has(dept.parentId)) {
      map.get(dept.parentId)!.children!.push(dept);
    } else {
      roots.push(dept);
    }
  }
  return roots;
}

export function resolveMemberPermissions(
  member: WorkspaceMember,
  roles: WorkspaceRole[],
): Set<ResourcePermission> {
  const allowed = new Set<ResourcePermission>();
  const roleMap = new Map(
    roles.filter((r) => r.workspaceId === member.workspaceId).map((r) => [r.id, r]),
  );

  for (const roleId of member.roleIds) {
    const role = roleMap.get(roleId);
    if (role) {
      for (const perm of role.permissions) {
        allowed.add(perm);
      }
    }
  }
  return allowed;
}

export function hasWorkspacePermission(
  member: WorkspaceMember | undefined,
  roles: WorkspaceRole[],
  targetWorkspaceId: string,
  permission: ResourcePermission,
): boolean {
  if (!member || member.workspaceId !== targetWorkspaceId) {
    return false;
  }
  const perms = resolveMemberPermissions(member, roles);
  return perms.has('org:admin') || perms.has(permission);
}

export function searchKnowledgeCards(
  cards: KnowledgeDocCard[],
  options: {
    workspaceId: string;
    query?: string;
    category?: KnowledgeDocCard['category'] | 'all';
    linkedFormSchemaId?: string;
  },
): KnowledgeDocCard[] {
  const q = (options.query ?? '').trim().toLowerCase();

  return cards.filter((card) => {
    if (card.workspaceId !== options.workspaceId) return false;
    if (options.category && options.category !== 'all' && card.category !== options.category) {
      return false;
    }
    if (
      options.linkedFormSchemaId &&
      !card.linkedFormSchemaIds.includes(options.linkedFormSchemaId)
    ) {
      return false;
    }
    if (!q) return true;

    const haystack = [
      card.title,
      card.summary,
      card.contentMarkdown,
      ...card.tags,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(q);
  });
}
