import {
  AuditLogEntry,
  FormValues,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowTicket,
  WorkspaceMember,
} from '../types/domain';
import { evaluateBooleanExpression } from './astEvaluator';

export interface TransitionInput {
  ticket: WorkflowTicket;
  workflow: WorkflowDefinition;
  actor: WorkspaceMember;
  action: 'approve' | 'reject' | 'return_to_node' | 'delegate' | 'resubmit';
  comment: string;
  targetNodeId?: string;
  delegateTo?: WorkspaceMember;
  updatedValues?: FormValues;
  nowIso?: string;
}

function findNode(workflow: WorkflowDefinition, nodeId: string): WorkflowNode {
  const found = workflow.nodes.find((n) => n.id === nodeId);
  if (!found) {
    throw new Error(`Workflow node "${nodeId}" not found in "${workflow.id}"`);
  }
  return found;
}

function computeSlaDeadline(node: WorkflowNode, enteredIso: string): string | undefined {
  if (!node.slaHours || node.slaHours <= 0) return undefined;
  const enteredMs = Date.parse(enteredIso);
  if (Number.isNaN(enteredMs)) return undefined;
  return new Date(enteredMs + node.slaHours * 3600 * 1000).toISOString();
}

export function checkTicketOverdue(ticket: WorkflowTicket, referenceIso?: string): boolean {
  if (ticket.status !== 'in_review') return false;
  if (!ticket.slaDeadlineAt) return false;
  const nowMs = referenceIso ? Date.parse(referenceIso) : Date.now();
  return nowMs > Date.parse(ticket.slaDeadlineAt);
}

/**
 * Resolves condition_gateway nodes recursively until landing on a concrete approval or end node.
 */
export function resolveReachableNode(
  workflow: WorkflowDefinition,
  candidateNodeId: string,
  values: FormValues,
  hopGuard = 0,
): WorkflowNode {
  if (hopGuard > 12) {
    throw new Error('Workflow routing loop detected while resolving condition gateways');
  }

  const node = findNode(workflow, candidateNodeId);
  if (node.kind !== 'condition_gateway') {
    return node;
  }

  const sortedBranches = [...(node.branches ?? [])].sort((a, b) => a.priority - b.priority);
  for (const branch of sortedBranches) {
    if (evaluateBooleanExpression(branch.expression, values, false)) {
      return resolveReachableNode(workflow, branch.targetNodeId, values, hopGuard + 1);
    }
  }

  if (node.defaultNextNodeId) {
    return resolveReachableNode(workflow, node.defaultNextNodeId, values, hopGuard + 1);
  }

  throw new Error(`Condition gateway "${node.name}" matched no branch and has no defaultNextNodeId`);
}

function makeAuditId(): string {
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createWorkflowTicket(params: {
  id?: string;
  workspaceId: string;
  formSchemaId: string;
  formVersion: number;
  workflow: WorkflowDefinition;
  title: string;
  applicant: WorkspaceMember;
  values: FormValues;
  nowIso?: string;
}): WorkflowTicket {
  const now = params.nowIso ?? new Date().toISOString();
  const startNode = params.workflow.nodes.find((n) => n.kind === 'start');
  if (!startNode || !startNode.nextNodeId) {
    throw new Error(`Workflow "${params.workflow.name}" is missing a valid start node`);
  }

  const firstActiveNode = resolveReachableNode(
    params.workflow,
    startNode.nextNodeId,
    params.values,
  );

  const ticketId =
    params.id ?? `tkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const isImmediateEnd = firstActiveNode.kind === 'end';
  const slaDeadlineAt = isImmediateEnd ? undefined : computeSlaDeadline(firstActiveNode, now);

  const initialLog: AuditLogEntry = {
    id: makeAuditId(),
    ticketId,
    workspaceId: params.workspaceId,
    nodeId: startNode.id,
    nodeName: startNode.name,
    actorId: params.applicant.id,
    actorName: params.applicant.name,
    action: 'submit',
    comment: '提交表单并发起流程',
    targetNodeId: firstActiveNode.id,
    createdAt: now,
  };

  return {
    id: ticketId,
    workspaceId: params.workspaceId,
    formSchemaId: params.formSchemaId,
    formVersion: params.formVersion,
    workflowId: params.workflow.id,
    title: params.title,
    applicantId: params.applicant.id,
    applicantName: params.applicant.name,
    status: isImmediateEnd ? 'approved' : 'in_review',
    currentNodeId: firstActiveNode.id,
    currentAssignees: isImmediateEnd ? [] : [...(firstActiveNode.assigneeIds ?? [])],
    nodeVotes: {},
    values: structuredClone(params.values),
    nodeEnteredAt: now,
    slaDeadlineAt,
    isOverdue: false,
    createdAt: now,
    updatedAt: now,
    auditLogs: [initialLog],
  };
}

export function transitionWorkflowTicket(input: TransitionInput): WorkflowTicket {
  const { ticket, workflow, actor, action, comment } = input;
  const now = input.nowIso ?? new Date().toISOString();
  const currentNode = findNode(workflow, ticket.currentNodeId);

  if (ticket.workspaceId !== workflow.workspaceId || actor.workspaceId !== ticket.workspaceId) {
    throw new Error('Cross-workspace workflow operation denied');
  }

  // Resubmit from 'returned' state
  if (action === 'resubmit') {
    if (ticket.status !== 'returned') {
      throw new Error('Only returned tickets can be resubmitted');
    }
    const nextValues = input.updatedValues ? structuredClone(input.updatedValues) : ticket.values;
    const startNode = workflow.nodes.find((n) => n.kind === 'start');
    const targetId =
      currentNode.kind === 'start' && startNode?.nextNodeId
        ? startNode.nextNodeId
        : currentNode.id;
    const resolved = resolveReachableNode(workflow, targetId, nextValues);
    const deadline = resolved.kind === 'end' ? undefined : computeSlaDeadline(resolved, now);

    return {
      ...ticket,
      values: nextValues,
      status: resolved.kind === 'end' ? 'approved' : 'in_review',
      currentNodeId: resolved.id,
      currentAssignees: resolved.kind === 'end' ? [] : [...(resolved.assigneeIds ?? [])],
      nodeVotes: { ...ticket.nodeVotes, [resolved.id]: [] },
      nodeEnteredAt: now,
      slaDeadlineAt: deadline,
      isOverdue: false,
      updatedAt: now,
      auditLogs: [
        ...ticket.auditLogs,
        {
          id: makeAuditId(),
          ticketId: ticket.id,
          workspaceId: ticket.workspaceId,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          actorId: actor.id,
          actorName: actor.name,
          action: 'resubmit',
          comment: comment || '修改后重新提交审批',
          targetNodeId: resolved.id,
          createdAt: now,
        },
      ],
    };
  }

  if (ticket.status !== 'in_review') {
    throw new Error(`Ticket is in "${ticket.status}" state and cannot accept "${action}"`);
  }

  if (!ticket.currentAssignees.includes(actor.id)) {
    throw new Error(`Actor "${actor.name}" is not an active assignee on node "${currentNode.name}"`);
  }

  // Delegate / transfer current approval slot to another member in same workspace
  if (action === 'delegate') {
    if (!input.delegateTo) {
      throw new Error('Target member is required for delegation');
    }
    if (input.delegateTo.workspaceId !== ticket.workspaceId) {
      throw new Error('Cannot delegate ticket across workspaces');
    }
    const updatedAssignees = ticket.currentAssignees.map((id) =>
      id === actor.id ? input.delegateTo!.id : id,
    );
    const dedupAssignees = Array.from(new Set(updatedAssignees));

    return {
      ...ticket,
      currentAssignees: dedupAssignees,
      isOverdue: checkTicketOverdue(ticket, now),
      updatedAt: now,
      auditLogs: [
        ...ticket.auditLogs,
        {
          id: makeAuditId(),
          ticketId: ticket.id,
          workspaceId: ticket.workspaceId,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          actorId: actor.id,
          actorName: actor.name,
          action: 'delegate',
          comment: comment || `转交审批权给 ${input.delegateTo.name}`,
          delegateToId: input.delegateTo.id,
          createdAt: now,
        },
      ],
    };
  }

  // Return / rollback to specified prior node
  if (action === 'return_to_node') {
    const fallbackStart = workflow.nodes.find((n) => n.kind === 'start');
    const targetId = input.targetNodeId ?? fallbackStart?.id;
    if (!targetId) {
      throw new Error('Return target node id is required');
    }
    if (
      currentNode.allowReturnToNodeIds &&
      currentNode.allowReturnToNodeIds.length > 0 &&
      !currentNode.allowReturnToNodeIds.includes(targetId)
    ) {
      throw new Error(`Node "${currentNode.name}" is not permitted to return to "${targetId}"`);
    }
    const targetNode = findNode(workflow, targetId);
    const isBackToStart = targetNode.kind === 'start';
    const nextAssignees = isBackToStart
      ? [ticket.applicantId]
      : [...(targetNode.assigneeIds ?? [ticket.applicantId])];

    return {
      ...ticket,
      status: isBackToStart ? 'returned' : 'in_review',
      currentNodeId: targetNode.id,
      currentAssignees: nextAssignees,
      nodeVotes: {
        ...ticket.nodeVotes,
        [currentNode.id]: [],
        [targetNode.id]: [],
      },
      nodeEnteredAt: now,
      slaDeadlineAt: isBackToStart ? undefined : computeSlaDeadline(targetNode, now),
      isOverdue: false,
      updatedAt: now,
      auditLogs: [
        ...ticket.auditLogs,
        {
          id: makeAuditId(),
          ticketId: ticket.id,
          workspaceId: ticket.workspaceId,
          nodeId: currentNode.id,
          nodeName: currentNode.name,
          actorId: actor.id,
          actorName: actor.name,
          action: 'return_to_node',
          comment: comment || `退回至节点「${targetNode.name}」`,
          targetNodeId: targetNode.id,
          createdAt: now,
        },
      ],
    };
  }

  // Approve or Reject on serial_approval / parallel_countersign
  const existingVotes = ticket.nodeVotes[currentNode.id] ?? [];
  if (existingVotes.some((v) => v.actorId === actor.id)) {
    throw new Error(`Actor "${actor.name}" has already voted on node "${currentNode.name}"`);
  }

  const nextNodeVotesList = [
    ...existingVotes,
    {
      actorId: actor.id,
      actorName: actor.name,
      decision: action,
      comment,
      actedAt: now,
    },
  ];

  const updatedNodeVotes = {
    ...ticket.nodeVotes,
    [currentNode.id]: nextNodeVotesList,
  };

  const baseAudit: AuditLogEntry = {
    id: makeAuditId(),
    ticketId: ticket.id,
    workspaceId: ticket.workspaceId,
    nodeId: currentNode.id,
    nodeName: currentNode.name,
    actorId: actor.id,
    actorName: actor.name,
    action,
    comment,
    createdAt: now,
  };

  // Evaluate completion criteria for serial vs parallel countersign
  const totalAssigned = Math.max(1, (currentNode.assigneeIds ?? ticket.currentAssignees).length);
  const approveCount = nextNodeVotesList.filter((v) => v.decision === 'approve').length;
  const rejectCount = nextNodeVotesList.filter((v) => v.decision === 'reject').length;

  let nodePassed = false;
  let nodeRejected = false;

  if (currentNode.kind === 'serial_approval') {
    if (action === 'approve') nodePassed = true;
    else nodeRejected = true;
  } else if (currentNode.kind === 'parallel_countersign') {
    const policy = currentNode.countersignPolicy ?? 'unanimous';
    const requiredRatio = policy === 'unanimous' ? 1 : (currentNode.passRatio ?? 1);

    if (policy === 'unanimous') {
      if (rejectCount > 0) {
        nodeRejected = true;
      } else if (approveCount >= totalAssigned) {
        nodePassed = true;
      }
    } else {
      const currentApproveRatio = approveCount / totalAssigned;
      const maxPossibleApproveRatio = (totalAssigned - rejectCount) / totalAssigned;
      if (currentApproveRatio >= requiredRatio) {
        nodePassed = true;
      } else if (maxPossibleApproveRatio < requiredRatio) {
        nodeRejected = true;
      }
    }
  }

  if (nodeRejected) {
    return {
      ...ticket,
      status: 'rejected',
      currentAssignees: [],
      nodeVotes: updatedNodeVotes,
      slaDeadlineAt: undefined,
      isOverdue: false,
      updatedAt: now,
      auditLogs: [...ticket.auditLogs, baseAudit],
    };
  }

  if (!nodePassed) {
    // Still waiting for remaining countersigners
    const votedIds = new Set(nextNodeVotesList.map((v) => v.actorId));
    const remainingAssignees = (currentNode.assigneeIds ?? ticket.currentAssignees).filter(
      (id) => !votedIds.has(id),
    );
    return {
      ...ticket,
      currentAssignees: remainingAssignees,
      nodeVotes: updatedNodeVotes,
      isOverdue: checkTicketOverdue(ticket, now),
      updatedAt: now,
      auditLogs: [...ticket.auditLogs, baseAudit],
    };
  }

  // Advance to next node
  if (!currentNode.nextNodeId) {
    return {
      ...ticket,
      status: 'approved',
      currentAssignees: [],
      nodeVotes: updatedNodeVotes,
      slaDeadlineAt: undefined,
      isOverdue: false,
      updatedAt: now,
      auditLogs: [...ticket.auditLogs, baseAudit],
    };
  }

  const nextResolved = resolveReachableNode(workflow, currentNode.nextNodeId, ticket.values);
  const reachedEnd = nextResolved.kind === 'end';

  return {
    ...ticket,
    status: reachedEnd ? 'approved' : 'in_review',
    currentNodeId: nextResolved.id,
    currentAssignees: reachedEnd ? [] : [...(nextResolved.assigneeIds ?? [])],
    nodeVotes: {
      ...updatedNodeVotes,
      [nextResolved.id]: [],
    },
    nodeEnteredAt: now,
    slaDeadlineAt: reachedEnd ? undefined : computeSlaDeadline(nextResolved, now),
    isOverdue: false,
    updatedAt: now,
    auditLogs: [
      ...ticket.auditLogs,
      {
        ...baseAudit,
        targetNodeId: nextResolved.id,
      },
    ],
  };
}
