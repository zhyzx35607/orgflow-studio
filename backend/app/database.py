"""
SQLite persistence layer & multi-workspace seed bootstrapper for OrgFlow Studio.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .expression_engine import evaluate_and_validate_form
from .workflow_service import apply_ticket_transition, build_new_ticket

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "orgflow.sqlite3"


def connect_db(db_path: str | Path | None = None) -> sqlite3.Connection:
    target = Path(db_path) if db_path else DEFAULT_DB_PATH
    if str(target) != ":memory:":
        target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_schema_and_seed(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            industry TEXT NOT NULL,
            description TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS departments (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            code TEXT NOT NULL,
            parent_id TEXT
        );

        CREATE TABLE IF NOT EXISTS roles (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            permissions_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS members (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            department_id TEXT NOT NULL,
            name TEXT NOT NULL,
            title TEXT NOT NULL,
            email TEXT NOT NULL,
            role_ids_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS form_schemas (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (id, workspace_id)
        );

        CREATE TABLE IF NOT EXISTS form_schema_versions (
            schema_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            saved_at TEXT NOT NULL,
            PRIMARY KEY (schema_id, workspace_id, version)
        );

        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (id, workspace_id)
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            status TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            action TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_docs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )

    existing = conn.execute("SELECT COUNT(*) AS cnt FROM workspaces").fetchone()["cnt"]
    if existing > 0:
        return

    workspaces = [
        (
            "ws_nebula",
            "NEBULA-TECH",
            "星云智造协同空间",
            "智能制造与研发",
            "研发物料采购、资本性支出预算与跨部门质量联合会签空间",
        ),
        (
            "ws_harbor",
            "HARBOR-LABS",
            "海港生科研究院",
            "生物医药与实验室协作",
            "实验耗材申领、合规伦理评审与多中心研究立项空间",
        ),
    ]
    conn.executemany("INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)", workspaces)

    departments = [
        ("dept_nb_root", "ws_nebula", "星云总部", "HQ", None),
        ("dept_nb_rd", "ws_nebula", "平台研发中心", "RD", "dept_nb_root"),
        ("dept_nb_fin", "ws_nebula", "财经与风控部", "FIN", "dept_nb_root"),
        ("dept_nb_sc", "ws_nebula", "供应链与采购部", "SCM", "dept_nb_root"),
        ("dept_hb_root", "ws_harbor", "海港院务会", "HQ", None),
        ("dept_hb_bio", "ws_harbor", "分子基因组实验室", "BIO", "dept_hb_root"),
        ("dept_hb_qa", "ws_harbor", "合规与质量办", "QA", "dept_hb_root"),
    ]
    conn.executemany("INSERT INTO departments VALUES (?, ?, ?, ?, ?)", departments)

    roles = [
        (
            "role_nb_admin",
            "ws_nebula",
            "WORKSPACE_ADMIN",
            "空间架构管理员",
            json.dumps(
                [
                    "schema:view",
                    "schema:edit",
                    "workflow:manage",
                    "ticket:submit",
                    "ticket:approve",
                    "doc:view",
                    "doc:edit",
                    "org:admin",
                ]
            ),
        ),
        (
            "role_nb_approver",
            "ws_nebula",
            "COMMITTEE_REVIEWER",
            "部门评审与会签委员",
            json.dumps(["schema:view", "ticket:submit", "ticket:approve", "doc:view", "doc:edit"]),
        ),
        (
            "role_nb_staff",
            "ws_nebula",
            "PROJECT_ENGINEER",
            "业务工程师",
            json.dumps(["schema:view", "ticket:submit", "doc:view"]),
        ),
        (
            "role_hb_admin",
            "ws_harbor",
            "LAB_DIRECTOR",
            "研究院负责人",
            json.dumps(
                [
                    "schema:view",
                    "schema:edit",
                    "workflow:manage",
                    "ticket:submit",
                    "ticket:approve",
                    "doc:view",
                    "doc:edit",
                    "org:admin",
                ]
            ),
        ),
        (
            "role_hb_researcher",
            "ws_harbor",
            "RESEARCHER",
            "课题研究员",
            json.dumps(["schema:view", "ticket:submit", "ticket:approve", "doc:view"]),
        ),
    ]
    conn.executemany("INSERT INTO roles VALUES (?, ?, ?, ?, ?)", roles)

    members: list[dict[str, Any]] = [
        {
            "id": "mem_lin",
            "workspaceId": "ws_nebula",
            "departmentId": "dept_nb_rd",
            "name": "林知夏",
            "title": "首席平台架构师",
            "email": "lin.zhixia@nebula.example",
            "roleIds": ["role_nb_admin"],
        },
        {
            "id": "mem_zhou",
            "workspaceId": "ws_nebula",
            "departmentId": "dept_nb_rd",
            "name": "周牧野",
            "title": "研发总监",
            "email": "zhou.muye@nebula.example",
            "roleIds": ["role_nb_approver"],
        },
        {
            "id": "mem_chen",
            "workspaceId": "ws_nebula",
            "departmentId": "dept_nb_sc",
            "name": "陈予安",
            "title": "供应链合规专家",
            "email": "chen.yuan@nebula.example",
            "roleIds": ["role_nb_approver"],
        },
        {
            "id": "mem_su",
            "workspaceId": "ws_nebula",
            "departmentId": "dept_nb_fin",
            "name": "苏瑾言",
            "title": "财务风控总监 (CFO)",
            "email": "su.jinyan@nebula.example",
            "roleIds": ["role_nb_approver"],
        },
        {
            "id": "mem_xu",
            "workspaceId": "ws_nebula",
            "departmentId": "dept_nb_rd",
            "name": "许星河",
            "title": "硬件系统工程师",
            "email": "xu.xinghe@nebula.example",
            "roleIds": ["role_nb_staff"],
        },
        {
            "id": "mem_gu",
            "workspaceId": "ws_harbor",
            "departmentId": "dept_hb_bio",
            "name": "顾清禾",
            "title": "实验室主任",
            "email": "gu.qinghe@harbor.example",
            "roleIds": ["role_hb_admin"],
        },
        {
            "id": "mem_tang",
            "workspaceId": "ws_harbor",
            "departmentId": "dept_hb_qa",
            "name": "唐书白",
            "title": "质量合规评审员",
            "email": "tang.shubai@harbor.example",
            "roleIds": ["role_hb_researcher"],
        },
    ]
    for m in members:
        conn.execute(
            "INSERT INTO members VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                m["id"],
                m["workspaceId"],
                m["departmentId"],
                m["name"],
                m["title"],
                m["email"],
                json.dumps(m["roleIds"]),
            ),
        )

    capex_schema: dict[str, Any] = {
        "id": "schema_capex_procure",
        "workspaceId": "ws_nebula",
        "code": "CAPEX_PROCUREMENT_V1",
        "title": "研发设备与云资源采购立项单",
        "description": "内置明细行自动计价、税费联动计算、大额立项风险说明显隐控制与预算红线校验",
        "version": 1,
        "updatedAt": "2026-03-01T09:00:00Z",
        "fields": [
            {"key": "projectTitle", "label": "采购立项名称", "type": "text", "required": True},
            {
                "key": "procurementMode",
                "label": "寻源方式",
                "type": "select",
                "required": True,
                "defaultValue": "bidding",
                "options": [
                    {"label": "公开比价招标", "value": "bidding"},
                    {"label": "单一来源采购", "value": "sole_source"},
                ],
            },
            {
                "key": "soleSourceReason",
                "label": "单一来源排他性论证说明",
                "type": "text",
                "required": True,
                "visibleWhen": "procurementMode == 'sole_source'",
            },
            {
                "key": "items",
                "label": "采购预算明细子表",
                "type": "subtable",
                "required": True,
                "defaultValue": [
                    {"itemName": "推理服务器节点", "qty": 2, "unitPrice": 24000, "subtotal": 48000},
                    {"itemName": "高速光模块套件", "qty": 4, "unitPrice": 2500, "subtotal": 10000},
                ],
                "columns": [
                    {"key": "itemName", "label": "标的物名称", "type": "text", "required": True},
                    {"key": "qty", "label": "数量", "type": "number", "required": True, "min": 1},
                    {"key": "unitPrice", "label": "单价", "type": "currency", "required": True, "min": 1},
                    {"key": "subtotal", "label": "行小计", "type": "currency", "computedExpr": "ROUND(qty * unitPrice, 2)"},
                ],
            },
            {"key": "discountAmount", "label": "减免金额", "type": "currency", "defaultValue": 2000, "min": 0},
            {"key": "taxRate", "label": "税率(%)", "type": "number", "defaultValue": 13, "min": 0, "max": 30},
            {
                "key": "subtotalAmount",
                "label": "明细汇总净额",
                "type": "currency",
                "computedExpr": "ROUND(SUM(items, 'subtotal') - discountAmount, 2)",
            },
            {
                "key": "grandTotal",
                "label": "含税采购总金额",
                "type": "currency",
                "computedExpr": "ROUND(subtotalAmount * (1 + taxRate / 100), 2)",
            },
            {
                "key": "cfoRiskMemo",
                "label": "大额资本支出 ROI 测算摘要",
                "type": "text",
                "required": True,
                "visibleWhen": "grandTotal >= 50000",
                "defaultValue": "预计上线后吞吐提升 3.2 倍。",
            },
        ],
        "crossFieldRules": [
            {
                "id": "rule_discount_cap",
                "name": "减免上限校验",
                "conditionExpr": "discountAmount <= SUM(items, 'subtotal') * 0.5",
                "errorMessage": "商务谈判减免金额不能超过采购明细汇总金额的 50%",
                "targetFieldKey": "discountAmount",
            }
        ],
    }

    harbor_schema: dict[str, Any] = {
        "id": "schema_reagent_req",
        "workspaceId": "ws_harbor",
        "code": "BIO_REAGENT_APPLY_V1",
        "title": "实验特种试剂申领与冷链核验单",
        "description": "海港生科研究院特种试剂申领单",
        "version": 1,
        "updatedAt": "2026-03-02T10:30:00Z",
        "fields": [
            {"key": "reagentBatchTitle", "label": "申领批次名称", "type": "text", "required": True},
            {"key": "unitCount", "label": "申领支数", "type": "number", "required": True, "min": 1, "defaultValue": 4},
            {"key": "unitCost", "label": "单支预算价", "type": "currency", "required": True, "min": 1, "defaultValue": 1500},
            {"key": "estimatedTotal", "label": "预算合计", "type": "currency", "computedExpr": "ROUND(unitCount * unitCost, 2)"},
        ],
        "crossFieldRules": [],
    }

    for sc in (capex_schema, harbor_schema):
        raw_json = json.dumps(sc, ensure_ascii=False)
        conn.execute(
            "INSERT INTO form_schemas VALUES (?, ?, ?, ?, ?)",
            (sc["id"], sc["workspaceId"], sc["version"], raw_json, sc["updatedAt"]),
        )
        conn.execute(
            "INSERT INTO form_schema_versions VALUES (?, ?, ?, ?, ?)",
            (sc["id"], sc["workspaceId"], sc["version"], raw_json, sc["updatedAt"]),
        )

    capex_wf: dict[str, Any] = {
        "id": "wf_capex_approval",
        "workspaceId": "ws_nebula",
        "formSchemaId": "schema_capex_procure",
        "name": "研发采购多级会签与大额财务路由流",
        "description": "部门主管初审 → 架构与供应链并行会签 → 金额条件网关（≥50,000元自动路由CFO）→ 归档",
        "version": 1,
        "nodes": [
            {"id": "node_start", "name": "申请人发起", "kind": "start", "nextNodeId": "node_dept_lead"},
            {
                "id": "node_dept_lead",
                "name": "部门主管初审",
                "kind": "serial_approval",
                "assigneeIds": ["mem_zhou"],
                "slaHours": 24,
                "nextNodeId": "node_tech_scm_countersign",
                "allowReturnToNodeIds": ["node_start"],
            },
            {
                "id": "node_tech_scm_countersign",
                "name": "架构与供应链联合会签",
                "kind": "parallel_countersign",
                "assigneeIds": ["mem_lin", "mem_chen"],
                "countersignPolicy": "unanimous",
                "passRatio": 1.0,
                "slaHours": 48,
                "nextNodeId": "node_amount_gateway",
                "allowReturnToNodeIds": ["node_start", "node_dept_lead"],
            },
            {
                "id": "node_amount_gateway",
                "name": "采购总金额条件路由网关",
                "kind": "condition_gateway",
                "branches": [
                    {
                        "id": "br_high_value",
                        "label": "含税总金额 ≥ 50,000 元路由财务总监",
                        "expression": "grandTotal >= 50000",
                        "targetNodeId": "node_cfo_final",
                        "priority": 1,
                    }
                ],
                "defaultNextNodeId": "node_end",
            },
            {
                "id": "node_cfo_final",
                "name": "财务总监 (CFO) 终审",
                "kind": "serial_approval",
                "assigneeIds": ["mem_su"],
                "slaHours": 24,
                "nextNodeId": "node_end",
                "allowReturnToNodeIds": ["node_start", "node_dept_lead", "node_tech_scm_countersign"],
            },
            {"id": "node_end", "name": "立项归档生效", "kind": "end"},
        ],
    }

    harbor_wf: dict[str, Any] = {
        "id": "wf_reagent_approval",
        "workspaceId": "ws_harbor",
        "formSchemaId": "schema_reagent_req",
        "name": "特种试剂双人合规审批流",
        "description": "质量办核验 → 实验室主任批准",
        "version": 1,
        "nodes": [
            {"id": "hb_start", "name": "提交申领", "kind": "start", "nextNodeId": "hb_qa"},
            {
                "id": "hb_qa",
                "name": "质量合规办核验",
                "kind": "serial_approval",
                "assigneeIds": ["mem_tang"],
                "slaHours": 12,
                "nextNodeId": "hb_director",
                "allowReturnToNodeIds": ["hb_start"],
            },
            {
                "id": "hb_director",
                "name": "实验室主任批准",
                "kind": "serial_approval",
                "assigneeIds": ["mem_gu"],
                "slaHours": 24,
                "nextNodeId": "hb_end",
                "allowReturnToNodeIds": ["hb_start", "hb_qa"],
            },
            {"id": "hb_end", "name": "出库放行", "kind": "end"},
        ],
    }

    for wf in (capex_wf, harbor_wf):
        conn.execute(
            "INSERT INTO workflows VALUES (?, ?, ?, ?)",
            (wf["id"], wf["workspaceId"], wf["version"], json.dumps(wf, ensure_ascii=False)),
        )

    evaluated_vals, _ = evaluate_and_validate_form(
        capex_schema, {"projectTitle": "边缘推理集群 GPU 扩容采购"}
    )
    xu = next(m for m in members if m["id"] == "mem_xu")
    zhou = next(m for m in members if m["id"] == "mem_zhou")
    seed_tkt = build_new_ticket(
        ticket_id="tkt_seed_gpu_cluster",
        workspace_id="ws_nebula",
        form_schema_id=capex_schema["id"],
        form_version=1,
        workflow=capex_wf,
        title="边缘推理集群 GPU 扩容采购",
        applicant=xu,
        values=evaluated_vals,
        now_iso="2026-03-10T08:00:00Z",
    )
    seed_tkt = apply_ticket_transition(
        ticket=seed_tkt,
        workflow=capex_wf,
        actor=zhou,
        action="approve",
        comment="研发算力扩容立项合理，流转联合会签。",
        now_iso="2026-03-10T11:20:00Z",
    )
    persist_ticket_with_audits(conn, seed_tkt)

    docs = [
        {
            "id": "doc_procure_policy",
            "workspaceId": "ws_nebula",
            "title": "《研发资本性支出与单一来源采购管理办法 v2.4》",
            "category": "policy",
            "summary": "含税总金额 ≥ 50,000 元自动升级 CFO 终审。",
            "contentMarkdown": "大额资本性支出需提供 ROI 测算说明。",
            "tags": ["采购制度", "CFO路由"],
            "linkedFormSchemaIds": ["schema_capex_procure"],
            "linkedWorkflowIds": ["wf_capex_approval"],
            "authorName": "苏瑾言",
            "updatedAt": "2026-03-05T14:00:00Z",
        },
        {
            "id": "doc_harbor_coldchain",
            "workspaceId": "ws_harbor",
            "title": "《-80℃ 超低温生物试剂冷链验收 SOP》",
            "category": "policy",
            "summary": "海港生科研究院特种酶制剂双人放行规范。",
            "contentMarkdown": "质量合规办须在 12 小时 SLA 内完成证书核验。",
            "tags": ["冷链合规", "SOP"],
            "linkedFormSchemaIds": ["schema_reagent_req"],
            "linkedWorkflowIds": ["wf_reagent_approval"],
            "authorName": "顾清禾",
            "updatedAt": "2026-03-06T09:40:00Z",
        },
    ]
    for d in docs:
        conn.execute(
            "INSERT INTO knowledge_docs VALUES (?, ?, ?, ?)",
            (d["id"], d["workspaceId"], json.dumps(d, ensure_ascii=False), d["updatedAt"]),
        )
    conn.commit()


def persist_ticket_with_audits(conn: sqlite3.Connection, ticket: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO tickets (id, workspace_id, status, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        """,
        (
            ticket["id"],
            ticket["workspaceId"],
            ticket["status"],
            json.dumps(ticket, ensure_ascii=False),
            ticket["updatedAt"],
        ),
    )
    for log in ticket.get("auditLogs", []):
        conn.execute(
            """
            INSERT OR IGNORE INTO audit_logs
            (id, ticket_id, workspace_id, node_id, actor_id, action, comment, created_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                log["id"],
                ticket["id"],
                ticket["workspaceId"],
                log["nodeId"],
                log["actorId"],
                log["action"],
                log["comment"],
                log["createdAt"],
                json.dumps(log, ensure_ascii=False),
            ),
        )
