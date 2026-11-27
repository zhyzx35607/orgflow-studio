import React, { useMemo, useState } from 'react';
import { BookOpen, Building2, FilePlus2, Search, Shield, Users } from 'lucide-react';
import {
  buildDepartmentTree,
  resolveMemberPermissions,
  searchKnowledgeCards,
} from '../engine/workspaceEngine';
import {
  DepartmentNode,
  FormSchema,
  KnowledgeDocCard,
  ResourcePermission,
  WorkspaceMember,
  WorkspaceRole,
} from '../types/domain';

interface WorkspaceDocsViewProps {
  workspaceId: string;
  departments: DepartmentNode[];
  roles: WorkspaceRole[];
  members: WorkspaceMember[];
  schemas: FormSchema[];
  docs: KnowledgeDocCard[];
  currentActor: WorkspaceMember;
  canEditDocs: boolean;
  onCreateDoc: (
    card: Omit<KnowledgeDocCard, 'id' | 'workspaceId' | 'updatedAt'>,
  ) => Promise<void>;
}

const ALL_PERMISSIONS: ResourcePermission[] = [
  'schema:view',
  'schema:edit',
  'workflow:manage',
  'ticket:submit',
  'ticket:approve',
  'doc:view',
  'doc:edit',
  'org:admin',
];

export const WorkspaceDocsView: React.FC<WorkspaceDocsViewProps> = ({
  workspaceId,
  departments,
  roles,
  members,
  schemas,
  docs,
  currentActor,
  canEditDocs,
  onCreateDoc,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<KnowledgeDocCard['category'] | 'all'>('all');
  const [newTitle, setNewTitle] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newTags, setNewTags] = useState('流程规范, 协同');
  const [showCreator, setShowCreator] = useState(false);

  const deptTree = useMemo(() => buildDepartmentTree(departments), [departments]);
  const filteredDocs = useMemo(
    () =>
      searchKnowledgeCards(docs, {
        workspaceId,
        query: searchQuery,
        category: categoryFilter,
      }),
    [docs, workspaceId, searchQuery, categoryFilter],
  );

  const renderDeptNode = (node: DepartmentNode) => {
    const deptMembers = members.filter((m) => m.departmentId === node.id);
    return (
      <li key={node.id} className="org-tree-node">
        <div className="org-dept-header">
          <Building2 size={14} />
          <strong>{node.name}</strong>
          <code>{node.code}</code>
          <span className="muted">({deptMembers.length} 人)</span>
        </div>
        {deptMembers.length > 0 && (
          <div className="org-member-pills">
            {deptMembers.map((m) => (
              <span key={m.id} className="member-pill">
                <Users size={12} /> {m.name} · {m.title}
              </span>
            ))}
          </div>
        )}
        {node.children && node.children.length > 0 && (
          <ul>{node.children.map((child) => renderDeptNode(child))}</ul>
        )}
      </li>
    );
  };

  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newSummary.trim()) return;
    await onCreateDoc({
      title: newTitle.trim(),
      category: 'guide',
      summary: newSummary.trim(),
      contentMarkdown: newSummary.trim(),
      tags: newTags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      linkedFormSchemaIds: schemas[0] ? [schemas[0].id] : [],
      linkedWorkflowIds: [],
      authorName: currentActor.name,
    });
    setNewTitle('');
    setNewSummary('');
    setShowCreator(false);
  };

  return (
    <div className="studio-split">
      {/* Left: Organization Hierarchy & Fine-Grained RBAC Matrix */}
      <section className="panel">
        <div className="panel-header">
          <h3>
            <Shield size={16} /> 树形组织架构与细粒度 RBAC 权限矩阵
          </h3>
        </div>

        <ul className="org-tree-root">{deptTree.map((root) => renderDeptNode(root))}</ul>

        <h4 className="section-subtitle">空间成员资源权限核验矩阵</h4>
        <div className="subtable-wrapper">
          <table className="subtable rbac-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                {ALL_PERMISSIONS.map((perm) => (
                  <th key={perm}>
                    <code>{perm}</code>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const perms = resolveMemberPermissions(m, roles);
                const roleNames = m.roleIds
                  .map((rid) => roles.find((r) => r.id === rid)?.name ?? rid)
                  .join(', ');
                return (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                    </td>
                    <td>{roleNames}</td>
                    {ALL_PERMISSIONS.map((p) => (
                      <td key={p} className="center-cell">
                        {perms.has('org:admin') || perms.has(p) ? '✓' : '—'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Right: Linked Collaborative Knowledge Cards */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>
              <BookOpen size={16} /> 关联表单与流程规范协同知识卡片 ({filteredDocs.length})
            </h3>
            <span className="muted">与当前空间表单 Schema、审批阈值规范实时联动检索</span>
          </div>
          {canEditDocs && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowCreator((v) => !v)}
            >
              <FilePlus2 size={15} /> 新建知识卡片
            </button>
          )}
        </div>

        {showCreator && (
          <form className="inspector-box" onSubmit={handleAddDoc}>
            <h4>发布空间协同规范卡片</h4>
            <input
              type="text"
              placeholder="知识卡片标题"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
            />
            <textarea
              rows={3}
              placeholder="制度摘要与操作指引..."
              value={newSummary}
              onChange={(e) => setNewSummary(e.target.value)}
              required
            />
            <input
              type="text"
              placeholder="标签（逗号分隔）"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
            />
            <button type="submit" className="btn btn-primary">
              确认发布
            </button>
          </form>
        )}

        <div className="doc-search-bar">
          <div className="search-input-wrap">
            <Search size={15} />
            <input
              type="text"
              placeholder="检索标题、正文条款或标签（如：CFO、AST公式、冷链）..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as KnowledgeDocCard['category'] | 'all')
            }
          >
            <option value="all">全部分类</option>
            <option value="policy">制度红线 (Policy)</option>
            <option value="guide">公式与设计指南 (Guide)</option>
            <option value="sla">会签与 SLA 规范 (SLA)</option>
          </select>
        </div>

        <div className="doc-card-list">
          {filteredDocs.map((doc) => (
            <article key={doc.id} className="doc-card">
              <div className="doc-card-header">
                <span className={`cat-badge ${doc.category}`}>{doc.category.toUpperCase()}</span>
                <h4>{doc.title}</h4>
              </div>
              <p className="doc-summary">{doc.summary}</p>
              <pre className="doc-markdown">{doc.contentMarkdown}</pre>
              <div className="doc-footer">
                <div className="doc-tags">
                  {doc.tags.map((t) => (
                    <span key={t} className="mini-tag">
                      #{t}
                    </span>
                  ))}
                </div>
                <span className="muted">
                  维护人: {doc.authorName} · 关联表单: {doc.linkedFormSchemaIds.length} 项
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
