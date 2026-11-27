import {
  DepartmentNode,
  FormSchema,
  KnowledgeDocCard,
  WorkflowDefinition,
  WorkflowTicket,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../types/domain';
import { createWorkflowTicket, transitionWorkflowTicket } from '../engine/workflowEngine';
import { evaluateFormSchema } from '../engine/formEngine';

export interface SeedBundle {
  workspaces: Workspace[];
  departments: DepartmentNode[];
  roles: WorkspaceRole[];
  members: WorkspaceMember[];
  schemas: FormSchema[];
  workflows: WorkflowDefinition[];
  tickets: WorkflowTicket[];
  docs: KnowledgeDocCard[];
}

export function createDefaultSeedBundle(): SeedBundle {
  const workspaces: Workspace[] = [
    {
      id: 'ws_nebula',
      code: 'NEBULA-TECH',
      name: '星云智造协同空间',
      industry: '智能制造与研发',
      description: '研发物料采购、资本性支出预算与跨部门质量联合会签空间',
    },
    {
      id: 'ws_harbor',
      code: 'HARBOR-LABS',
      name: '海港生科研究院',
      industry: '生物医药与实验室协作',
      description: '实验耗材申领、合规伦理评审与多中心研究立项空间',
    },
  ];

  const departments: DepartmentNode[] = [
    { id: 'dept_nb_root', workspaceId: 'ws_nebula', name: '星云总部', code: 'HQ', parentId: null },
    { id: 'dept_nb_rd', workspaceId: 'ws_nebula', name: '平台研发中心', code: 'RD', parentId: 'dept_nb_root' },
    { id: 'dept_nb_fin', workspaceId: 'ws_nebula', name: '财经与风控部', code: 'FIN', parentId: 'dept_nb_root' },
    { id: 'dept_nb_sc', workspaceId: 'ws_nebula', name: '供应链与采购部', code: 'SCM', parentId: 'dept_nb_root' },

    { id: 'dept_hb_root', workspaceId: 'ws_harbor', name: '海港院务会', code: 'HQ', parentId: null },
    { id: 'dept_hb_bio', workspaceId: 'ws_harbor', name: '分子基因组实验室', code: 'BIO', parentId: 'dept_hb_root' },
    { id: 'dept_hb_qa', workspaceId: 'ws_harbor', name: '合规与质量办', code: 'QA', parentId: 'dept_hb_root' },
  ];

  const roles: WorkspaceRole[] = [
    {
      id: 'role_nb_admin',
      workspaceId: 'ws_nebula',
      code: 'WORKSPACE_ADMIN',
      name: '空间架构管理员',
      permissions: [
        'schema:view',
        'schema:edit',
        'workflow:manage',
        'ticket:submit',
        'ticket:approve',
        'doc:view',
        'doc:edit',
        'org:admin',
      ],
    },
    {
      id: 'role_nb_approver',
      workspaceId: 'ws_nebula',
      code: 'COMMITTEE_REVIEWER',
      name: '部门评审与会签委员',
      permissions: ['schema:view', 'ticket:submit', 'ticket:approve', 'doc:view', 'doc:edit'],
    },
    {
      id: 'role_nb_staff',
      workspaceId: 'ws_nebula',
      code: 'PROJECT_ENGINEER',
      name: '业务工程师',
      permissions: ['schema:view', 'ticket:submit', 'doc:view'],
    },
    {
      id: 'role_hb_admin',
      workspaceId: 'ws_harbor',
      code: 'LAB_DIRECTOR',
      name: '研究院负责人',
      permissions: [
        'schema:view',
        'schema:edit',
        'workflow:manage',
        'ticket:submit',
        'ticket:approve',
        'doc:view',
        'doc:edit',
        'org:admin',
      ],
    },
    {
      id: 'role_hb_researcher',
      workspaceId: 'ws_harbor',
      code: 'RESEARCHER',
      name: '课题研究员',
      permissions: ['schema:view', 'ticket:submit', 'ticket:approve', 'doc:view'],
    },
  ];

  const members: WorkspaceMember[] = [
    {
      id: 'mem_lin',
      workspaceId: 'ws_nebula',
      departmentId: 'dept_nb_rd',
      name: '林知夏',
      title: '首席平台架构师',
      email: 'lin.zhixia@nebula.example',
      roleIds: ['role_nb_admin'],
    },
    {
      id: 'mem_zhou',
      workspaceId: 'ws_nebula',
      departmentId: 'dept_nb_rd',
      name: '周牧野',
      title: '研发总监',
      email: 'zhou.muye@nebula.example',
      roleIds: ['role_nb_approver'],
    },
    {
      id: 'mem_chen',
      workspaceId: 'ws_nebula',
      departmentId: 'dept_nb_sc',
      name: '陈予安',
      title: '供应链合规专家',
      email: 'chen.yuan@nebula.example',
      roleIds: ['role_nb_approver'],
    },
    {
      id: 'mem_su',
      workspaceId: 'ws_nebula',
      departmentId: 'dept_nb_fin',
      name: '苏瑾言',
      title: '财务风控总监 (CFO)',
      email: 'su.jinyan@nebula.example',
      roleIds: ['role_nb_approver'],
    },
    {
      id: 'mem_xu',
      workspaceId: 'ws_nebula',
      departmentId: 'dept_nb_rd',
      name: '许星河',
      title: '硬件系统工程师',
      email: 'xu.xinghe@nebula.example',
      roleIds: ['role_nb_staff'],
    },
    {
      id: 'mem_gu',
      workspaceId: 'ws_harbor',
      departmentId: 'dept_hb_bio',
      name: '顾清禾',
      title: '实验室主任',
      email: 'gu.qinghe@harbor.example',
      roleIds: ['role_hb_admin'],
    },
    {
      id: 'mem_tang',
      workspaceId: 'ws_harbor',
      departmentId: 'dept_hb_qa',
      name: '唐书白',
      title: '质量合规评审员',
      email: 'tang.shubai@harbor.example',
      roleIds: ['role_hb_researcher'],
    },
  ];

  const capexSchema: FormSchema = {
    id: 'schema_capex_procure',
    workspaceId: 'ws_nebula',
    code: 'CAPEX_PROCUREMENT_V1',
    title: '研发设备与云资源采购立项单',
    description: '内置明细行自动计价、税费联动计算、大额立项风险说明显隐控制与预算红线校验',
    version: 1,
    updatedAt: '2026-03-01T09:00:00.000Z',
    fields: [
      {
        key: 'projectTitle',
        label: '采购立项名称',
        type: 'text',
        required: true,
        placeholder: '例如：边缘推理集群 GPU 扩容采购',
      },
      {
        key: 'category',
        label: '采购类别',
        type: 'select',
        required: true,
        defaultValue: 'hardware',
        options: [
          { label: '算力与硬件设备', value: 'hardware' },
          { label: '云原生软件订阅', value: 'cloud_saas' },
          { label: '外部技术咨询服务', value: 'consulting' },
        ],
      },
      {
        key: 'procurementMode',
        label: '寻源方式',
        type: 'select',
        required: true,
        defaultValue: 'bidding',
        options: [
          { label: '公开比价招标（≥3家）', value: 'bidding' },
          { label: '单一来源采购', value: 'sole_source' },
        ],
      },
      {
        key: 'soleSourceReason',
        label: '单一来源排他性论证说明',
        type: 'text',
        required: true,
        placeholder: '请详述专利排他或接口唯一性依据',
        visibleWhen: "procurementMode == 'sole_source'",
      },
      {
        key: 'ownerId',
        label: '项目技术负责人',
        type: 'member',
        required: true,
        defaultValue: 'mem_xu',
      },
      {
        key: 'expectedDate',
        label: '期望交付日期',
        type: 'date',
        required: true,
        defaultValue: '2026-04-15',
      },
      {
        key: 'complianceTags',
        label: '安全与合规属性',
        type: 'multiselect',
        defaultValue: ['iso27001'],
        options: [
          { label: 'ISO27001 信息安全认证', value: 'iso27001' },
          { label: '绿色低功耗认证', value: 'green_energy' },
          { label: '国产化信创适配', value: 'trusted_compute' },
        ],
      },
      {
        key: 'items',
        label: '采购预算明细子表',
        type: 'subtable',
        required: true,
        defaultValue: [
          { itemName: '推理服务器节点', qty: 2, unitPrice: 24000, subtotal: 48000 },
          { itemName: '高速光模块套件', qty: 4, unitPrice: 2500, subtotal: 10000 },
        ],
        columns: [
          { key: 'itemName', label: '标的物名称', type: 'text', required: true },
          { key: 'qty', label: '数量', type: 'number', required: true, min: 1 },
          { key: 'unitPrice', label: '不含税单价(元)', type: 'currency', required: true, min: 1 },
          {
            key: 'subtotal',
            label: '行小计(自动公式)',
            type: 'currency',
            computedExpr: 'ROUND(qty * unitPrice, 2)',
          },
        ],
      },
      {
        key: 'discountAmount',
        label: '商务谈判减免金额(元)',
        type: 'currency',
        defaultValue: 2000,
        min: 0,
      },
      {
        key: 'taxRate',
        label: '适用增值税率(%)',
        type: 'number',
        defaultValue: 13,
        min: 0,
        max: 30,
      },
      {
        key: 'subtotalAmount',
        label: '明细汇总净额(元)',
        type: 'currency',
        computedExpr: "ROUND(SUM(items, 'subtotal') - discountAmount, 2)",
      },
      {
        key: 'grandTotal',
        label: '含税采购总金额(元)',
        type: 'currency',
        computedExpr: 'ROUND(subtotalAmount * (1 + taxRate / 100), 2)',
      },
      {
        key: 'cfoRiskMemo',
        label: '大额资本支出 ROI 测算摘要',
        type: 'text',
        required: true,
        placeholder: '总金额 ≥ 50,000 元时必填投资回报测算说明',
        visibleWhen: 'grandTotal >= 50000',
        defaultValue: '预计集群上线后推理吞吐提升 3.2 倍，10 个月收回硬件投资成本。',
      },
    ],
    crossFieldRules: [
      {
        id: 'rule_discount_cap',
        name: '减免金额不得超过明细总额50%',
        conditionExpr: "discountAmount <= SUM(items, 'subtotal') * 0.5",
        errorMessage: '商务谈判减免金额不能超过采购明细汇总金额的 50%',
        targetFieldKey: 'discountAmount',
      },
      {
        id: 'rule_positive_total',
        name: '含税总金额必须大于0',
        conditionExpr: 'grandTotal > 0',
        errorMessage: '含税采购总金额必须大于 0 元',
        targetFieldKey: 'grandTotal',
      },
    ],
  };

  const harborSchema: FormSchema = {
    id: 'schema_reagent_req',
    workspaceId: 'ws_harbor',
    code: 'BIO_REAGENT_APPLY_V1',
    title: '实验特种试剂申领与冷链核验单',
    description: '海港生科研究院特种试剂申领单，支持危化冷链运输条件自动触发合规校验',
    version: 1,
    updatedAt: '2026-03-02T10:30:00.000Z',
    fields: [
      {
        key: 'reagentBatchTitle',
        label: '课题申领批次名称',
        type: 'text',
        required: true,
        defaultValue: 'CRISPR 文库测序酶制剂批次 #09',
      },
      {
        key: 'storageLevel',
        label: '温控存储等级',
        type: 'select',
        required: true,
        defaultValue: 'ultra_cold',
        options: [
          { label: '常温密封 (15~25℃)', value: 'normal' },
          { label: '超低温冷链 (-80℃)', value: 'ultra_cold' },
        ],
      },
      {
        key: 'coldChainCertNo',
        label: '冷链容器校准证书编号',
        type: 'text',
        required: true,
        defaultValue: 'CC-2026-8841',
        visibleWhen: "storageLevel == 'ultra_cold'",
      },
      {
        key: 'unitCount',
        label: '申领支数',
        type: 'number',
        required: true,
        min: 1,
        defaultValue: 6,
      },
      {
        key: 'unitCost',
        label: '单支预算价(元)',
        type: 'currency',
        required: true,
        min: 1,
        defaultValue: 1850,
      },
      {
        key: 'estimatedTotal',
        label: '申领预算合计(元)',
        type: 'currency',
        computedExpr: 'ROUND(unitCount * unitCost, 2)',
      },
    ],
    crossFieldRules: [],
  };

  const capexWorkflow: WorkflowDefinition = {
    id: 'wf_capex_approval',
    workspaceId: 'ws_nebula',
    formSchemaId: 'schema_capex_procure',
    name: '研发采购多级会签与大额财务路由流',
    description: '部门主管初审 → 技术与供应链并行会签 → 金额条件网关（≥50,000元自动路由财务总监）→ 归档',
    version: 1,
    nodes: [
      {
        id: 'node_start',
        name: '申请人发起',
        kind: 'start',
        nextNodeId: 'node_dept_lead',
      },
      {
        id: 'node_dept_lead',
        name: '部门主管初审',
        kind: 'serial_approval',
        assigneeIds: ['mem_zhou'],
        slaHours: 24,
        nextNodeId: 'node_tech_scm_countersign',
        allowReturnToNodeIds: ['node_start'],
      },
      {
        id: 'node_tech_scm_countersign',
        name: '架构与供应链联合会签',
        kind: 'parallel_countersign',
        assigneeIds: ['mem_lin', 'mem_chen'],
        countersignPolicy: 'unanimous',
        passRatio: 1,
        slaHours: 48,
        nextNodeId: 'node_amount_gateway',
        allowReturnToNodeIds: ['node_start', 'node_dept_lead'],
      },
      {
        id: 'node_amount_gateway',
        name: '采购总金额条件路由网关',
        kind: 'condition_gateway',
        branches: [
          {
            id: 'br_high_value',
            label: '含税总金额 ≥ 50,000 元路由财务总监',
            expression: 'grandTotal >= 50000',
            targetNodeId: 'node_cfo_final',
            priority: 1,
          },
        ],
        defaultNextNodeId: 'node_end',
      },
      {
        id: 'node_cfo_final',
        name: '财务总监 (CFO) 终审',
        kind: 'serial_approval',
        assigneeIds: ['mem_su'],
        slaHours: 24,
        nextNodeId: 'node_end',
        allowReturnToNodeIds: ['node_start', 'node_dept_lead', 'node_tech_scm_countersign'],
      },
      {
        id: 'node_end',
        name: '立项归档生效',
        kind: 'end',
      },
    ],
  };

  const harborWorkflow: WorkflowDefinition = {
    id: 'wf_reagent_approval',
    workspaceId: 'ws_harbor',
    formSchemaId: 'schema_reagent_req',
    name: '特种试剂双人合规审批流',
    description: '质量办初审 → 实验室主任终审',
    version: 1,
    nodes: [
      { id: 'hb_start', name: '提交申领', kind: 'start', nextNodeId: 'hb_qa' },
      {
        id: 'hb_qa',
        name: '质量合规办核验',
        kind: 'serial_approval',
        assigneeIds: ['mem_tang'],
        slaHours: 12,
        nextNodeId: 'hb_director',
        allowReturnToNodeIds: ['hb_start'],
      },
      {
        id: 'hb_director',
        name: '实验室主任批准',
        kind: 'serial_approval',
        assigneeIds: ['mem_gu'],
        slaHours: 24,
        nextNodeId: 'hb_end',
        allowReturnToNodeIds: ['hb_start', 'hb_qa'],
      },
      { id: 'hb_end', name: '出库放行', kind: 'end' },
    ],
  };

  // Pre-evaluate seed ticket #1 (in parallel countersign stage, high amount >= 50,000)
  const eval1 = evaluateFormSchema(capexSchema, {});
  let ticket1 = createWorkflowTicket({
    id: 'tkt_seed_gpu_cluster',
    workspaceId: 'ws_nebula',
    formSchemaId: capexSchema.id,
    formVersion: 1,
    workflow: capexWorkflow,
    title: '边缘推理集群 GPU 扩容采购',
    applicant: members.find((m) => m.id === 'mem_xu')!,
    values: {
      ...eval1.evaluatedValues,
      projectTitle: '边缘推理集群 GPU 扩容采购',
    },
    nowIso: '2026-03-10T08:00:00.000Z',
  });
  ticket1 = transitionWorkflowTicket({
    ticket: ticket1,
    workflow: capexWorkflow,
    actor: members.find((m) => m.id === 'mem_zhou')!,
    action: 'approve',
    comment: '研发算力缺口属实，同意进入架构与供应链联合会签。',
    nowIso: '2026-03-10T11:20:00.000Z',
  });

  // Seed ticket #2 (small cloud subscription < 50,000, already approved via gateway shortcut)
  const smallRaw = {
    projectTitle: '自动化测试云沙箱年度订阅',
    category: 'cloud_saas',
    procurementMode: 'bidding',
    ownerId: 'mem_xu',
    expectedDate: '2026-04-01',
    complianceTags: ['iso27001', 'green_energy'],
    items: [{ itemName: '并发执行节点授权', qty: 3, unitPrice: 6000, subtotal: 18000 }],
    discountAmount: 1000,
    taxRate: 6,
  };
  const eval2 = evaluateFormSchema(capexSchema, smallRaw);
  let ticket2 = createWorkflowTicket({
    id: 'tkt_seed_cloud_sandbox',
    workspaceId: 'ws_nebula',
    formSchemaId: capexSchema.id,
    formVersion: 1,
    workflow: capexWorkflow,
    title: '自动化测试云沙箱年度订阅',
    applicant: members.find((m) => m.id === 'mem_xu')!,
    values: eval2.evaluatedValues,
    nowIso: '2026-03-08T09:00:00.000Z',
  });
  ticket2 = transitionWorkflowTicket({
    ticket: ticket2,
    workflow: capexWorkflow,
    actor: members.find((m) => m.id === 'mem_zhou')!,
    action: 'approve',
    comment: '预算内常规订阅，同意。',
    nowIso: '2026-03-08T10:00:00.000Z',
  });
  ticket2 = transitionWorkflowTicket({
    ticket: ticket2,
    workflow: capexWorkflow,
    actor: members.find((m) => m.id === 'mem_lin')!,
    action: 'approve',
    comment: '技术架构兼容通过。',
    nowIso: '2026-03-08T13:00:00.000Z',
  });
  ticket2 = transitionWorkflowTicket({
    ticket: ticket2,
    workflow: capexWorkflow,
    actor: members.find((m) => m.id === 'mem_chen')!,
    action: 'approve',
    comment: '供应商三方比价合规，总金额低于 5 万自动办结。',
    nowIso: '2026-03-08T14:30:00.000Z',
  });

  const evalHb = evaluateFormSchema(harborSchema, {});
  const ticket3 = createWorkflowTicket({
    id: 'tkt_seed_reagent_09',
    workspaceId: 'ws_harbor',
    formSchemaId: harborSchema.id,
    formVersion: 1,
    workflow: harborWorkflow,
    title: 'CRISPR 文库测序酶制剂批次 #09',
    applicant: members.find((m) => m.id === 'mem_gu')!,
    values: evalHb.evaluatedValues,
    nowIso: '2026-03-11T09:15:00.000Z',
  });

  const docs: KnowledgeDocCard[] = [
    {
      id: 'doc_procure_policy',
      workspaceId: 'ws_nebula',
      title: '《研发资本性支出与单一来源采购管理办法 v2.4》',
      category: 'policy',
      summary: '明确含税总金额 ≥ 50,000 元自动升级 CFO 终审，单一来源必须提供专利或排他性技术论证。',
      contentMarkdown:
        '### 关键审批阈值\n1. **常规研发采购 (< 50,000 元)**：经部门主管初审 + 架构/供应链全票会签后自动归档生效。\n2. **大额资本支出 (≥ 50,000 元)**：条件网关自动路由至财务风控总监（CFO）完成 ROI 复核。\n3. **商务减免红线**：录入减免金额不得超过明细小计汇总的 50%。',
      tags: ['采购制度', '分级授权', 'CFO路由'],
      linkedFormSchemaIds: ['schema_capex_procure'],
      linkedWorkflowIds: ['wf_capex_approval'],
      authorName: '苏瑾言',
      updatedAt: '2026-03-05T14:00:00.000Z',
    },
    {
      id: 'doc_ast_formula_spec',
      workspaceId: 'ws_nebula',
      title: '《OrgFlow 动态表单安全 AST 公式编写手册》',
      category: 'guide',
      summary: '详解无 eval 确定性公式语法：支持子表聚合 SUM(items, "subtotal")、ROUND 精度控制与 visibleWhen 显隐联动。',
      contentMarkdown:
        '### 常用内置函数\n- `SUM(items, \'subtotal\')`：对明细子表指定数值列求和\n- `ROUND(expr, 2)`：四舍五入保留指定位数\n- `IF(cond, a, b)`：条件分支求值\n- `INCLUDES(complianceTags, \'iso27001\')`：判断多选集合包含项',
      tags: ['AST公式', '动态表单', '安全沙箱'],
      linkedFormSchemaIds: ['schema_capex_procure'],
      linkedWorkflowIds: [],
      authorName: '林知夏',
      updatedAt: '2026-03-07T16:20:00.000Z',
    },
    {
      id: 'doc_sla_countersign',
      workspaceId: 'ws_nebula',
      title: '《跨部门并行会签与 SLA 超时预警作业规范》',
      category: 'sla',
      summary: '规定全票会签（Unanimous）与比例会签（Ratio）适用场景，以及审批转交与指定节点退回操作准则。',
      contentMarkdown:
        '### 会签策略说明\n- **全票通过 (Unanimous)**：任一委员驳回则流程立即终止，全员通过方可流转下一节点。\n- **按比例通过 (Ratio)**：如设置 `passRatio = 0.67`，3 人中 2 人同意即刻提前推进，无需苦等末位。\n- **退回重审**：支持退回至发起人修改或退回上一级节点重审。',
      tags: ['并行会签', 'SLA预警', '退回重审'],
      linkedFormSchemaIds: ['schema_capex_procure'],
      linkedWorkflowIds: ['wf_capex_approval'],
      authorName: '陈予安',
      updatedAt: '2026-03-09T11:10:00.000Z',
    },
    {
      id: 'doc_harbor_coldchain',
      workspaceId: 'ws_harbor',
      title: '《-80℃ 超低温生物试剂冷链验收 SOP》',
      category: 'policy',
      summary: '海港生科研究院特种酶制剂冷链证书校验与双人放行规范。',
      contentMarkdown:
        '凡存储等级选择 `ultra_cold` 的申领单，动态表单自动强制要求填写冷链容器校准证书编号，并由质量办在 12 小时 SLA 内完成核验。',
      tags: ['冷链合规', '生物安全', 'SOP'],
      linkedFormSchemaIds: ['schema_reagent_req'],
      linkedWorkflowIds: ['wf_reagent_approval'],
      authorName: '顾清禾',
      updatedAt: '2026-03-06T09:40:00.000Z',
    },
  ];

  return {
    workspaces,
    departments,
    roles,
    members,
    schemas: [capexSchema, harborSchema],
    workflows: [capexWorkflow, harborWorkflow],
    tickets: [ticket1, ticket2, ticket3],
    docs,
  };
}
