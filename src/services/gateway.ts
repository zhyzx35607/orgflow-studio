import { createDefaultSeedBundle, SeedBundle } from '../data/seedData';
import { evaluateFormSchema } from '../engine/formEngine';
import {
  checkTicketOverdue,
  createWorkflowTicket,
  transitionWorkflowTicket,
} from '../engine/workflowEngine';
import {
  FormSchema,
  FormValues,
  KnowledgeDocCard,
  WorkflowDefinition,
  WorkflowTicket,
  Workspace,
  WorkspaceMember,
} from '../types/domain';

export type GatewayMode = 'local' | 'fastapi';

const STORAGE_KEY = 'orgflow_studio_state_v1';

export interface WorkspaceSnapshot {
  workspace: Workspace;
  departments: SeedBundle['departments'];
  roles: SeedBundle['roles'];
  members: WorkspaceMember[];
  schemas: FormSchema[];
  workflows: WorkflowDefinition[];
  tickets: WorkflowTicket[];
  docs: KnowledgeDocCard[];
}

function loadLocalBundle(): SeedBundle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as SeedBundle;
    }
  } catch {
    // Fallback to clean seed if storage unavailable
  }
  const fresh = createDefaultSeedBundle();
  saveLocalBundle(fresh);
  return fresh;
}

function saveLocalBundle(bundle: SeedBundle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
  } catch {
    // Ignore quota errors in headless environments
  }
}

export class OrgFlowGateway {
  private mode: GatewayMode = 'local';
  private apiBaseUrl: string;

  constructor(apiBaseUrl = '/api') {
    this.apiBaseUrl = apiBaseUrl;
  }

  public getMode(): GatewayMode {
    return this.mode;
  }

  public setMode(mode: GatewayMode): void {
    this.mode = mode;
  }

  public async probeBackend(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const resp = await fetch(`${this.apiBaseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return resp.ok;
    } catch {
      return false;
    }
  }

  public resetLocalDemoData(): SeedBundle {
    const fresh = createDefaultSeedBundle();
    saveLocalBundle(fresh);
    return fresh;
  }

  public async listWorkspaces(): Promise<Workspace[]> {
    if (this.mode === 'fastapi') {
      const res = await fetch(`${this.apiBaseUrl}/workspaces`);
      if (!res.ok) throw new Error('Failed to load workspaces from FastAPI');
      return (await res.json()) as Workspace[];
    }
    return loadLocalBundle().workspaces;
  }

  public async getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    if (this.mode === 'fastapi') {
      const res = await fetch(`${this.apiBaseUrl}/workspaces/${workspaceId}/snapshot`);
      if (!res.ok) throw new Error(`Failed to fetch workspace snapshot (${res.status})`);
      return (await res.json()) as WorkspaceSnapshot;
    }

    const bundle = loadLocalBundle();
    const workspace = bundle.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace "${workspaceId}" not found`);
    }

    return {
      workspace,
      departments: bundle.departments.filter((d) => d.workspaceId === workspaceId),
      roles: bundle.roles.filter((r) => r.workspaceId === workspaceId),
      members: bundle.members.filter((m) => m.workspaceId === workspaceId),
      schemas: bundle.schemas.filter((s) => s.workspaceId === workspaceId),
      workflows: bundle.workflows.filter((w) => w.workspaceId === workspaceId),
      tickets: bundle.tickets
        .filter((t) => t.workspaceId === workspaceId)
        .map((t) => ({ ...t, isOverdue: checkTicketOverdue(t) })),
      docs: bundle.docs.filter((d) => d.workspaceId === workspaceId),
    };
  }

  public async saveFormSchema(workspaceId: string, schema: FormSchema): Promise<FormSchema> {
    if (this.mode === 'fastapi') {
      const res = await fetch(`${this.apiBaseUrl}/workspaces/${workspaceId}/schemas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schema),
      });
      if (!res.ok) throw new Error('Failed to save schema on backend');
      return (await res.json()) as FormSchema;
    }

    const bundle = loadLocalBundle();
    const idx = bundle.schemas.findIndex(
      (s) => s.id === schema.id && s.workspaceId === workspaceId,
    );
    const nextSchema: FormSchema = {
      ...structuredClone(schema),
      workspaceId,
      version: idx >= 0 ? bundle.schemas[idx].version + 1 : 1,
      updatedAt: new Date().toISOString(),
    };

    const nextSchemas =
      idx >= 0
        ? bundle.schemas.map((s, i) => (i === idx ? nextSchema : s))
        : [...bundle.schemas, nextSchema];

    saveLocalBundle({ ...bundle, schemas: nextSchemas });
    return nextSchema;
  }

  public async saveWorkflow(
    workspaceId: string,
    workflow: WorkflowDefinition,
  ): Promise<WorkflowDefinition> {
    if (this.mode === 'fastapi') {
      const res = await fetch(`${this.apiBaseUrl}/workspaces/${workspaceId}/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      if (!res.ok) throw new Error('Failed to save workflow on backend');
      return (await res.json()) as WorkflowDefinition;
    }

    const bundle = loadLocalBundle();
    const idx = bundle.workflows.findIndex(
      (w) => w.id === workflow.id && w.workspaceId === workspaceId,
    );
    const nextWf: WorkflowDefinition = {
      ...structuredClone(workflow),
      workspaceId,
      version: idx >= 0 ? bundle.workflows[idx].version + 1 : 1,
    };
    const nextWorkflows =
      idx >= 0
        ? bundle.workflows.map((w, i) => (i === idx ? nextWf : w))
        : [...bundle.workflows, nextWf];
    saveLocalBundle({ ...bundle, workflows: nextWorkflows });
    return nextWf;
  }

  public async submitTicket(params: {
    workspaceId: string;
    formSchemaId: string;
    workflowId: string;
    applicantId: string;
    title: string;
    values: FormValues;
  }): Promise<WorkflowTicket> {
    if (this.mode === 'fastapi') {
      const res = await fetch(`${this.apiBaseUrl}/workspaces/${params.workspaceId}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Submit ticket failed: ${detail}`);
      }
      return (await res.json()) as WorkflowTicket;
    }

    const bundle = loadLocalBundle();
    const schema = bundle.schemas.find(
      (s) => s.id === params.formSchemaId && s.workspaceId === params.workspaceId,
    );
    const workflow = bundle.workflows.find(
      (w) => w.id === params.workflowId && w.workspaceId === params.workspaceId,
    );
    const applicant = bundle.members.find(
      (m) => m.id === params.applicantId && m.workspaceId === params.workspaceId,
    );

    if (!schema || !workflow || !applicant) {
      throw new Error('Invalid form schema, workflow, or applicant for workspace');
    }

    const evalSnapshot = evaluateFormSchema(schema, params.values);
    if (!evalSnapshot.valid) {
      throw new Error(evalSnapshot.errors.map((e) => e.message).join('；'));
    }

    const created = createWorkflowTicket({
      workspaceId: params.workspaceId,
      formSchemaId: schema.id,
      formVersion: schema.version,
      workflow,
      title: params.title,
      applicant,
      values: evalSnapshot.evaluatedValues,
    });

    saveLocalBundle({
      ...bundle,
      tickets: [created, ...bundle.tickets],
    });
    return created;
  }

  public async actOnTicket(params: {
    workspaceId: string;
    ticketId: string;
    actorId: string;
    action: 'approve' | 'reject' | 'return_to_node' | 'delegate' | 'resubmit';
    comment: string;
    targetNodeId?: string;
    delegateToId?: string;
    updatedValues?: FormValues;
  }): Promise<WorkflowTicket> {
    if (this.mode === 'fastapi') {
      const res = await fetch(
        `${this.apiBaseUrl}/workspaces/${params.workspaceId}/tickets/${params.ticketId}/actions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Ticket transition failed: ${detail}`);
      }
      return (await res.json()) as WorkflowTicket;
    }

    const bundle = loadLocalBundle();
    const ticket = bundle.tickets.find(
      (t) => t.id === params.ticketId && t.workspaceId === params.workspaceId,
    );
    if (!ticket) throw new Error('Ticket not found in current workspace');

    const workflow = bundle.workflows.find((w) => w.id === ticket.workflowId);
    const actor = bundle.members.find(
      (m) => m.id === params.actorId && m.workspaceId === params.workspaceId,
    );
    if (!workflow || !actor) throw new Error('Workflow or actor not found');

    const delegateTo = params.delegateToId
      ? bundle.members.find(
          (m) => m.id === params.delegateToId && m.workspaceId === params.workspaceId,
        )
      : undefined;

    const updated = transitionWorkflowTicket({
      ticket,
      workflow,
      actor,
      action: params.action,
      comment: params.comment,
      targetNodeId: params.targetNodeId,
      delegateTo,
      updatedValues: params.updatedValues,
    });

    saveLocalBundle({
      ...bundle,
      tickets: bundle.tickets.map((t) => (t.id === updated.id ? updated : t)),
    });
    return updated;
  }

  public async createDocCard(
    workspaceId: string,
    card: Omit<KnowledgeDocCard, 'id' | 'workspaceId' | 'updatedAt'>,
  ): Promise<KnowledgeDocCard> {
    if (this.mode === 'fastapi') {
      const res = await fetch(`${this.apiBaseUrl}/workspaces/${workspaceId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
      });
      if (!res.ok) throw new Error('Failed to create knowledge card');
      return (await res.json()) as KnowledgeDocCard;
    }

    const bundle = loadLocalBundle();
    const created: KnowledgeDocCard = {
      ...card,
      id: `doc_${Date.now().toString(36)}`,
      workspaceId,
      updatedAt: new Date().toISOString(),
    };
    saveLocalBundle({ ...bundle, docs: [created, ...bundle.docs] });
    return created;
  }
}

export const defaultGateway = new OrgFlowGateway();
