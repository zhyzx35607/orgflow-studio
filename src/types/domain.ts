export type FieldType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'member'
  | 'subtable';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SubtableColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'currency' | 'select';
  required?: boolean;
  min?: number;
  max?: number;
  options?: SelectOption[];
  computedExpr?: string;
}

export interface CrossFieldRule {
  id: string;
  name: string;
  conditionExpr: string;
  errorMessage: string;
  targetFieldKey?: string;
}

export interface FormFieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  pattern?: string;
  options?: SelectOption[];
  visibleWhen?: string;
  computedExpr?: string;
  columns?: SubtableColumn[];
}

export interface FormSchema {
  id: string;
  workspaceId: string;
  code: string;
  title: string;
  description: string;
  version: number;
  updatedAt: string;
  fields: FormFieldSchema[];
  crossFieldRules: CrossFieldRule[];
}

export type FormValues = Record<string, unknown>;

export interface FieldValidationError {
  fieldKey: string;
  label: string;
  message: string;
  rowIndex?: number;
  columnKey?: string;
}

export interface FormEvaluationSnapshot {
  evaluatedValues: FormValues;
  visibleMap: Record<string, boolean>;
  errors: FieldValidationError[];
  valid: boolean;
  formulaTrace: Record<string, { expression: string; result: unknown; error?: string }>;
}

export type WorkflowNodeKind =
  | 'start'
  | 'serial_approval'
  | 'parallel_countersign'
  | 'condition_gateway'
  | 'end';

export type CountersignPolicy = 'unanimous' | 'ratio';

export interface WorkflowConditionBranch {
  id: string;
  label: string;
  expression: string;
  targetNodeId: string;
  priority: number;
}

export interface WorkflowNode {
  id: string;
  name: string;
  kind: WorkflowNodeKind;
  assigneeIds?: string[];
  roleCode?: string;
  countersignPolicy?: CountersignPolicy;
  passRatio?: number;
  nextNodeId?: string;
  branches?: WorkflowConditionBranch[];
  defaultNextNodeId?: string;
  slaHours?: number;
  allowReturnToNodeIds?: string[];
}

export interface WorkflowDefinition {
  id: string;
  workspaceId: string;
  formSchemaId: string;
  name: string;
  description: string;
  version: number;
  nodes: WorkflowNode[];
}

export type TicketStatus =
  | 'draft'
  | 'in_review'
  | 'returned'
  | 'approved'
  | 'rejected';

export type ApprovalActionType =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'return_to_node'
  | 'delegate'
  | 'resubmit';

export interface NodeVoteRecord {
  actorId: string;
  actorName: string;
  decision: 'approve' | 'reject';
  comment: string;
  actedAt: string;
}

export interface AuditLogEntry {
  id: string;
  ticketId: string;
  workspaceId: string;
  nodeId: string;
  nodeName: string;
  actorId: string;
  actorName: string;
  action: ApprovalActionType;
  comment: string;
  targetNodeId?: string;
  delegateToId?: string;
  createdAt: string;
}

export interface WorkflowTicket {
  id: string;
  workspaceId: string;
  formSchemaId: string;
  formVersion: number;
  workflowId: string;
  title: string;
  applicantId: string;
  applicantName: string;
  status: TicketStatus;
  currentNodeId: string;
  currentAssignees: string[];
  nodeVotes: Record<string, NodeVoteRecord[]>;
  values: FormValues;
  nodeEnteredAt: string;
  slaDeadlineAt?: string;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
  auditLogs: AuditLogEntry[];
}

export type ResourcePermission =
  | 'schema:view'
  | 'schema:edit'
  | 'workflow:manage'
  | 'ticket:submit'
  | 'ticket:approve'
  | 'doc:view'
  | 'doc:edit'
  | 'org:admin';

export interface WorkspaceRole {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  permissions: ResourcePermission[];
}

export interface DepartmentNode {
  id: string;
  workspaceId: string;
  name: string;
  code: string;
  parentId: string | null;
  children?: DepartmentNode[];
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  departmentId: string;
  name: string;
  title: string;
  email: string;
  roleIds: string[];
}

export interface Workspace {
  id: string;
  code: string;
  name: string;
  industry: string;
  description: string;
}

export interface KnowledgeDocCard {
  id: string;
  workspaceId: string;
  title: string;
  category: 'policy' | 'guide' | 'template' | 'sla';
  summary: string;
  contentMarkdown: string;
  tags: string[];
  linkedFormSchemaIds: string[];
  linkedWorkflowIds: string[];
  authorName: string;
  updatedAt: string;
}
