import { describe, expect, it } from 'vitest';
import { createDefaultSeedBundle } from '../../data/seedData';
import {
  checkTicketOverdue,
  createWorkflowTicket,
  transitionWorkflowTicket,
} from '../workflowEngine';
import {
  buildDepartmentTree,
  hasWorkspacePermission,
  searchKnowledgeCards,
} from '../workspaceEngine';
import { WorkflowDefinition } from '../../types/domain';

describe('Workflow DAG & Multi-Sign Engine', () => {
  it('routes high-value tickets (>= 50,000) to CFO after unanimous parallel countersign', () => {
    const seed = createDefaultSeedBundle();
    const wf = seed.workflows.find((w) => w.id === 'wf_capex_approval')!;
    const xu = seed.members.find((m) => m.id === 'mem_xu')!;
    const zhou = seed.members.find((m) => m.id === 'mem_zhou')!;
    const lin = seed.members.find((m) => m.id === 'mem_lin')!;
    const chen = seed.members.find((m) => m.id === 'mem_chen')!;
    const su = seed.members.find((m) => m.id === 'mem_su')!;

    let tkt = createWorkflowTicket({
      workspaceId: 'ws_nebula',
      formSchemaId: 'schema_capex_procure',
      formVersion: 1,
      workflow: wf,
      title: '大额算力集群采购',
      applicant: xu,
      values: { grandTotal: 65000 },
    });
    expect(tkt.currentNodeId).toBe('node_dept_lead');

    tkt = transitionWorkflowTicket({
      ticket: tkt,
      workflow: wf,
      actor: zhou,
      action: 'approve',
      comment: '初审通过',
    });
    expect(tkt.currentNodeId).toBe('node_tech_scm_countersign');
    expect(tkt.currentAssignees).toEqual(['mem_lin', 'mem_chen']);

    // First countersigner approves -> still waiting for second
    tkt = transitionWorkflowTicket({
      ticket: tkt,
      workflow: wf,
      actor: lin,
      action: 'approve',
      comment: '架构通过',
    });
    expect(tkt.status).toBe('in_review');
    expect(tkt.currentNodeId).toBe('node_tech_scm_countersign');
    expect(tkt.currentAssignees).toEqual(['mem_chen']);

    // Second countersigner approves -> condition gateway routes to CFO
    tkt = transitionWorkflowTicket({
      ticket: tkt,
      workflow: wf,
      actor: chen,
      action: 'approve',
      comment: '供应链通过',
    });
    expect(tkt.currentNodeId).toBe('node_cfo_final');
    expect(tkt.currentAssignees).toEqual(['mem_su']);

    tkt = transitionWorkflowTicket({
      ticket: tkt,
      workflow: wf,
      actor: su,
      action: 'approve',
      comment: 'CFO 终审批准',
    });
    expect(tkt.status).toBe('approved');
    expect(tkt.auditLogs).toHaveLength(5);
  });

  it('rejects immediately on unanimous countersign when any member rejects', () => {
    const seed = createDefaultSeedBundle();
    const wf = seed.workflows.find((w) => w.id === 'wf_capex_approval')!;
    const ticketInCountersign = seed.tickets.find((t) => t.id === 'tkt_seed_gpu_cluster')!;
    const chen = seed.members.find((m) => m.id === 'mem_chen')!;

    const rejected = transitionWorkflowTicket({
      ticket: ticketInCountersign,
      workflow: wf,
      actor: chen,
      action: 'reject',
      comment: '供应商资质过期，驳回立项',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.currentAssignees).toEqual([]);
  });

  it('supports ratio-based parallel countersign (e.g. 2/3 passes immediately)', () => {
    const seed = createDefaultSeedBundle();
    const lin = seed.members.find((m) => m.id === 'mem_lin')!;
    const chen = seed.members.find((m) => m.id === 'mem_chen')!;
    const zhou = seed.members.find((m) => m.id === 'mem_zhou')!;
    const xu = seed.members.find((m) => m.id === 'mem_xu')!;

    const ratioWf: WorkflowDefinition = {
      id: 'wf_ratio',
      workspaceId: 'ws_nebula',
      formSchemaId: 'schema_capex_procure',
      name: '比例会签测试流',
      description: '',
      version: 1,
      nodes: [
        { id: 's', name: 'Start', kind: 'start', nextNodeId: 'cs' },
        {
          id: 'cs',
          name: '三人委员会比例会签',
          kind: 'parallel_countersign',
          assigneeIds: [lin.id, chen.id, zhou.id],
          countersignPolicy: 'ratio',
          passRatio: 0.66,
          nextNodeId: 'e',
        },
        { id: 'e', name: 'End', kind: 'end' },
      ],
    };

    let tkt = createWorkflowTicket({
      workspaceId: 'ws_nebula',
      formSchemaId: 'schema_capex_procure',
      formVersion: 1,
      workflow: ratioWf,
      title: '比例会签测试单',
      applicant: xu,
      values: {},
    });
    tkt = transitionWorkflowTicket({
      ticket: tkt,
      workflow: ratioWf,
      actor: lin,
      action: 'approve',
      comment: '1/3 同意',
    });
    expect(tkt.status).toBe('in_review');

    tkt = transitionWorkflowTicket({
      ticket: tkt,
      workflow: ratioWf,
      actor: chen,
      action: 'approve',
      comment: '2/3 同意达到 66% 阈值',
    });
    expect(tkt.status).toBe('approved');
  });

  it('supports return_to_node and resubmit lifecycle', () => {
    const seed = createDefaultSeedBundle();
    const wf = seed.workflows.find((w) => w.id === 'wf_capex_approval')!;
    const tkt = seed.tickets.find((t) => t.id === 'tkt_seed_gpu_cluster')!;
    const lin = seed.members.find((m) => m.id === 'mem_lin')!;
    const xu = seed.members.find((m) => m.id === 'mem_xu')!;

    const returned = transitionWorkflowTicket({
      ticket: tkt,
      workflow: wf,
      actor: lin,
      action: 'return_to_node',
      targetNodeId: 'node_start',
      comment: '请补充服务器机柜功耗参数',
    });
    expect(returned.status).toBe('returned');
    expect(returned.currentNodeId).toBe('node_start');

    const resubmitted = transitionWorkflowTicket({
      ticket: returned,
      workflow: wf,
      actor: xu,
      action: 'resubmit',
      comment: '已补充功耗参数',
      updatedValues: { ...returned.values, grandTotal: 42000 },
    });
    expect(resubmitted.status).toBe('in_review');
    expect(resubmitted.currentNodeId).toBe('node_dept_lead');
  });

  it('supports delegation within workspace and blocks cross-workspace delegation', () => {
    const seed = createDefaultSeedBundle();
    const wf = seed.workflows.find((w) => w.id === 'wf_capex_approval')!;
    const tkt = seed.tickets.find((t) => t.id === 'tkt_seed_gpu_cluster')!;
    const lin = seed.members.find((m) => m.id === 'mem_lin')!;
    const su = seed.members.find((m) => m.id === 'mem_su')!;
    const gu = seed.members.find((m) => m.id === 'mem_gu')!; // From ws_harbor

    expect(() =>
      transitionWorkflowTicket({
        ticket: tkt,
        workflow: wf,
        actor: lin,
        action: 'delegate',
        delegateTo: gu,
        comment: '跨空间转交应被拒绝',
      }),
    ).toThrow();

    const delegated = transitionWorkflowTicket({
      ticket: tkt,
      workflow: wf,
      actor: lin,
      action: 'delegate',
      delegateTo: su,
      comment: '休假转交苏总监代审',
    });
    expect(delegated.currentAssignees).toContain('mem_su');
    expect(delegated.currentAssignees).not.toContain('mem_lin');
  });

  it('detects SLA overdue status accurately', () => {
    const seed = createDefaultSeedBundle();
    const tkt = seed.tickets.find((t) => t.id === 'tkt_seed_gpu_cluster')!;
    expect(checkTicketOverdue(tkt, '2026-03-11T00:00:00.000Z')).toBe(false);
    expect(checkTicketOverdue(tkt, '2026-03-20T00:00:00.000Z')).toBe(true);
  });

  it('prevents non-assignees from approving a node', () => {
    const seed = createDefaultSeedBundle();
    const wf = seed.workflows.find((w) => w.id === 'wf_capex_approval')!;
    const tkt = seed.tickets.find((t) => t.id === 'tkt_seed_gpu_cluster')!;
    const xu = seed.members.find((m) => m.id === 'mem_xu')!;

    expect(() =>
      transitionWorkflowTicket({
        ticket: tkt,
        workflow: wf,
        actor: xu,
        action: 'approve',
        comment: '越权审批',
      }),
    ).toThrow();
  });
});

describe('Workspace Tree, RBAC Permissions & Knowledge Docs', () => {
  it('builds nested department tree and isolates workspaces', () => {
    const seed = createDefaultSeedBundle();
    const nebulaDepts = seed.departments.filter((d) => d.workspaceId === 'ws_nebula');
    const tree = buildDepartmentTree(nebulaDepts);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('星云总部');
    expect(tree[0].children).toHaveLength(3);
  });

  it('enforces RBAC permissions and workspace isolation', () => {
    const seed = createDefaultSeedBundle();
    const lin = seed.members.find((m) => m.id === 'mem_lin')!;
    const xu = seed.members.find((m) => m.id === 'mem_xu')!;

    expect(hasWorkspacePermission(lin, seed.roles, 'ws_nebula', 'schema:edit')).toBe(true);
    expect(hasWorkspacePermission(lin, seed.roles, 'ws_harbor', 'schema:edit')).toBe(false);
    expect(hasWorkspacePermission(xu, seed.roles, 'ws_nebula', 'schema:edit')).toBe(false);
    expect(hasWorkspacePermission(xu, seed.roles, 'ws_nebula', 'ticket:submit')).toBe(true);
  });

  it('searches collaborative knowledge cards by query and category within workspace', () => {
    const seed = createDefaultSeedBundle();
    const results = searchKnowledgeCards(seed.docs, {
      workspaceId: 'ws_nebula',
      query: 'AST',
      category: 'guide',
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('doc_ast_formula_spec');

    const crossTenant = searchKnowledgeCards(seed.docs, {
      workspaceId: 'ws_harbor',
      query: 'AST',
    });
    expect(crossTenant).toHaveLength(0);
  });
});
