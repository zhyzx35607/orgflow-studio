import React, { useState } from 'react';
import {
  Check,
  Clock,
  CornerUpLeft,
  GitBranch,
  RotateCcw,
  Share2,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  WorkflowDefinition,
  WorkflowTicket,
  WorkspaceMember,
} from '../types/domain';

interface WorkflowCenterViewProps {
  workflows: WorkflowDefinition[];
  tickets: WorkflowTicket[];
  members: WorkspaceMember[];
  currentActor: WorkspaceMember;
  onActOnTicket: (params: {
    ticketId: string;
    action: 'approve' | 'reject' | 'return_to_node' | 'delegate' | 'resubmit';
    comment: string;
    targetNodeId?: string;
    delegateToId?: string;
  }) => Promise<void>;
  onSaveWorkflow: (wf: WorkflowDefinition) => Promise<void>;
}

const STATUS_LABELS: Record<WorkflowTicket['status'], string> = {
  draft: '草稿',
  in_review: '审批流转中',
  returned: '已退回待修改',
  approved: '已批准归档',
  rejected: '已驳回终止',
};

export const WorkflowCenterView: React.FC<WorkflowCenterViewProps> = ({
  workflows,
  tickets,
  members,
  currentActor,
  onActOnTicket,
  onSaveWorkflow,
}) => {
  const [selectedTicketId, setSelectedTicketId] = useState<string>(tickets[0]?.id ?? '');
  const [comment, setComment] = useState<string>('');
  const [returnNodeId, setReturnNodeId] = useState<string>('');
  const [delegateMemberId, setDelegateMemberId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (!tickets.some((t) => t.id === selectedTicketId)) {
      setSelectedTicketId(tickets[0]?.id ?? '');
    }
  }, [tickets, selectedTicketId]);

  const activeTicket = tickets.find((t) => t.id === selectedTicketId);
  const activeWorkflow = workflows.find((w) => w.id === activeTicket?.workflowId) ?? workflows[0];
  const currentNode = activeWorkflow?.nodes.find((n) => n.id === activeTicket?.currentNodeId);

  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  const isCurrentAssignee = Boolean(
    activeTicket && activeTicket.currentAssignees.includes(currentActor.id),
  );

  const triggerAction = async (
    action: 'approve' | 'reject' | 'return_to_node' | 'delegate' | 'resubmit',
  ) => {
    if (!activeTicket) return;
    setErrorMsg(null);
    try {
      await onActOnTicket({
        ticketId: activeTicket.id,
        action,
        comment: comment.trim() || `执行 ${action} 操作`,
        targetNodeId: action === 'return_to_node' ? returnNodeId || undefined : undefined,
        delegateToId: action === 'delegate' ? delegateMemberId || undefined : undefined,
      });
      setComment('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleCountersignPolicy = async () => {
    if (!activeWorkflow) return;
    const updated: WorkflowDefinition = {
      ...activeWorkflow,
      nodes: activeWorkflow.nodes.map((node) => {
        if (node.kind !== 'parallel_countersign') return node;
        const nextPolicy = node.countersignPolicy === 'unanimous' ? 'ratio' : 'unanimous';
        return {
          ...node,
          countersignPolicy: nextPolicy,
          passRatio: nextPolicy === 'ratio' ? 0.5 : 1,
        };
      }),
    };
    await onSaveWorkflow(updated);
  };

  return (
    <div className="workflow-layout">
      {/* Workflow DAG Topology Bar */}
      {activeWorkflow && (
        <section className="panel dag-panel">
          <div className="panel-header">
            <div>
              <h3>
                <GitBranch size={16} /> 流程编排拓扑 · {activeWorkflow.name} (v
                {activeWorkflow.version})
              </h3>
              <span className="muted">{activeWorkflow.description}</span>
            </div>
            {activeWorkflow.nodes.some((n) => n.kind === 'parallel_countersign') && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={toggleCountersignPolicy}
              >
                切换会签策略（全票 / 50%比例通过）
              </button>
            )}
          </div>

          <div className="dag-nodes-track">
            {activeWorkflow.nodes.map((node, i) => {
              const isCurrent = activeTicket?.currentNodeId === node.id;
              return (
                <React.Fragment key={node.id}>
                  <div className={`dag-node-card ${node.kind} ${isCurrent ? 'current' : ''}`}>
                    <div className="dag-node-kind">{node.kind}</div>
                    <strong>{node.name}</strong>
                    {node.assigneeIds && node.assigneeIds.length > 0 && (
                      <div className="dag-meta">
                        处理人: {node.assigneeIds.map(memberName).join('、')}
                      </div>
                    )}
                    {node.kind === 'parallel_countersign' && (
                      <div className="dag-meta highlight">
                        策略:{' '}
                        {node.countersignPolicy === 'unanimous'
                          ? '全票通过 (100%)'
                          : `按比例通过 (${Math.round((node.passRatio ?? 1) * 100)}%)`}
                      </div>
                    )}
                    {node.kind === 'condition_gateway' &&
                      (node.branches ?? []).map((b) => (
                        <div key={b.id} className="dag-meta branch">
                          若 <code>{b.expression}</code> → {b.targetNodeId}
                        </div>
                      ))}
                    {node.slaHours && <div className="dag-meta">SLA 限时: {node.slaHours}h</div>}
                  </div>
                  {i < activeWorkflow.nodes.length - 1 && <div className="dag-arrow">→</div>}
                </React.Fragment>
              );
            })}
          </div>
        </section>
      )}

      <div className="studio-split">
        {/* Ticket Queue */}
        <section className="panel">
          <div className="panel-header">
            <h3>协同审批工单队列 ({tickets.length})</h3>
            <span className="muted">当前操作身份：{currentActor.name}</span>
          </div>
          <div className="ticket-list">
            {tickets.map((t) => {
              const mine = t.currentAssignees.includes(currentActor.id);
              return (
                <div
                  key={t.id}
                  className={`ticket-card ${t.id === selectedTicketId ? 'selected' : ''}`}
                  onClick={() => setSelectedTicketId(t.id)}
                >
                  <div className="ticket-card-top">
                    <strong>{t.title}</strong>
                    <span className={`status-pill ${t.status}`}>{STATUS_LABELS[t.status]}</span>
                  </div>
                  <div className="ticket-card-meta">
                    <span>申请人: {t.applicantName}</span>
                    <span>当前节点: {t.currentNodeId}</span>
                    {mine && <span className="todo-badge">待我处理</span>}
                    {t.isOverdue && (
                      <span className="overdue-badge">
                        <Clock size={12} /> SLA 超时预警
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Ticket Detail, Countersign Action & Immutable Audit Trail */}
        <section className="panel">
          {activeTicket ? (
            <>
              <div className="panel-header">
                <div>
                  <h3>{activeTicket.title}</h3>
                  <span className="muted">
                    工单号: <code>{activeTicket.id}</code> · 当前停靠:{' '}
                    <strong>{currentNode?.name ?? activeTicket.currentNodeId}</strong>
                  </span>
                </div>
                <span className={`status-pill ${activeTicket.status}`}>
                  {STATUS_LABELS[activeTicket.status]}
                </span>
              </div>

              <div className="kv-summary">
                <div>
                  <span>当前待办责任人：</span>
                  <strong>
                    {activeTicket.currentAssignees.length > 0
                      ? activeTicket.currentAssignees.map(memberName).join('、')
                      : '无（流程已办结）'}
                  </strong>
                </div>
                {activeTicket.slaDeadlineAt && (
                  <div>
                    <span>SLA 截止时间：</span>
                    <strong>
                      {new Date(activeTicket.slaDeadlineAt).toLocaleString()}{' '}
                      {activeTicket.isOverdue ? '（已超时）' : ''}
                    </strong>
                  </div>
                )}
              </div>

              <details className="payload-Collapse" open>
                <summary>表单物化数据快照 (Form Payload)</summary>
                <pre className="snapshot-json">
                  {JSON.stringify(activeTicket.values, null, 2)}
                </pre>
              </details>

              {errorMsg && <div className="field-error">{errorMsg}</div>}

              {activeTicket.status === 'in_review' && (
                <div className="approval-action-box">
                  <h4>
                    <ShieldCheck size={15} /> 审批/会签操作台（当前身份：{currentActor.name}）
                  </h4>
                  {!isCurrentAssignee && (
                    <p className="muted">
                      提示：当前节点待处理人为{' '}
                      {activeTicket.currentAssignees.map(memberName).join('、')}
                      ，可在顶部导航栏切换对应成员身份进行会签体验。
                    </p>
                  )}
                  <textarea
                    rows={2}
                    placeholder="填写审批/会签意见或退回原因..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <div className="action-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!isCurrentAssignee}
                      onClick={() => triggerAction('approve')}
                    >
                      <Check size={14} /> 同意通过
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={!isCurrentAssignee}
                      onClick={() => triggerAction('reject')}
                    >
                      <XCircle size={14} /> 驳回终止
                    </button>

                    <div className="inline-control">
                      <select
                        value={returnNodeId}
                        onChange={(e) => setReturnNodeId(e.target.value)}
                      >
                        <option value="">退回至发起人</option>
                        {(currentNode?.allowReturnToNodeIds ?? []).map((nid) => {
                          const targetN = activeWorkflow?.nodes.find((n) => n.id === nid);
                          return (
                            <option key={nid} value={nid}>
                              退回至: {targetN?.name ?? nid}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        className="btn btn-outline"
                        disabled={!isCurrentAssignee}
                        onClick={() => triggerAction('return_to_node')}
                      >
                        <CornerUpLeft size={14} /> 退回节点
                      </button>
                    </div>

                    <div className="inline-control">
                      <select
                        value={delegateMemberId}
                        onChange={(e) => setDelegateMemberId(e.target.value)}
                      >
                        <option value="">-- 选择转交人 --</option>
                        {members
                          .filter((m) => m.id !== currentActor.id)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.title})
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-outline"
                        disabled={!isCurrentAssignee || !delegateMemberId}
                        onClick={() => triggerAction('delegate')}
                      >
                        <Share2 size={14} /> 转交
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTicket.status === 'returned' && (
                <div className="approval-action-box">
                  <textarea
                    rows={2}
                    placeholder="填写补充修订说明后重新提交..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => triggerAction('resubmit')}
                  >
                    <RotateCcw size={14} /> 重新提交审批
                  </button>
                </div>
              )}

              <div className="audit-timeline">
                <h4>全链路不可篡改审计轨迹 ({activeTicket.auditLogs.length})</h4>
                {activeTicket.auditLogs.map((log) => (
                  <div key={log.id} className="audit-item">
                    <div className="audit-dot" />
                    <div className="audit-content">
                      <div>
                        <strong>{log.actorName}</strong> 在节点「{log.nodeName}」执行{' '}
                        <code>{log.action}</code>
                        <span className="audit-time">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p>{log.comment}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">当前空间暂无审批工单。</p>
          )}
        </section>
      </div>
    </div>
  );
};
