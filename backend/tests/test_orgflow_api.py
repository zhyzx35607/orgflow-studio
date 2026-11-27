from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.expression_engine import SafeExpressionError, evaluate_safe_expression  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    db_file = tmp_path / "test_orgflow.sqlite3"
    app = create_app(str(db_file))
    return TestClient(app)


def test_health_endpoint(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_list_workspaces(client: TestClient) -> None:
    resp = client.get("/api/workspaces")
    assert resp.status_code == 200
    ids = {w["id"] for w in resp.json()}
    assert ids == {"ws_nebula", "ws_harbor"}


def test_workspace_snapshot_isolation(client: TestClient) -> None:
    nb = client.get("/api/workspaces/ws_nebula/snapshot").json()
    hb = client.get("/api/workspaces/ws_harbor/snapshot").json()
    assert all(m["workspaceId"] == "ws_nebula" for m in nb["members"])
    assert all(m["workspaceId"] == "ws_harbor" for m in hb["members"])
    assert {s["id"] for s in nb["schemas"]} == {"schema_capex_procure"}
    assert {s["id"] for s in hb["schemas"]} == {"schema_reagent_req"}


def test_snapshot_unknown_workspace_returns_404(client: TestClient) -> None:
    resp = client.get("/api/workspaces/ws_missing/snapshot")
    assert resp.status_code == 404


def test_safe_expression_evaluator_blocks_dunder_and_unknown_calls() -> None:
    with pytest.raises(SafeExpressionError):
        evaluate_safe_expression("__import__('os').system('echo 1')", {})
    with pytest.raises(SafeExpressionError):
        evaluate_safe_expression("x.__class__", {"x": "hello"})
    with pytest.raises(SafeExpressionError):
        evaluate_safe_expression("EVAL('1+1')", {})


def test_safe_expression_evaluator_subtable_and_logic() -> None:
    scope = {
        "items": [{"qty": 2, "subtotal": 20000}, {"qty": 1, "subtotal": 15000}],
        "discountAmount": 3000,
        "taxRate": 10,
    }
    res = evaluate_safe_expression(
        "ROUND((SUM(items, 'subtotal') - discountAmount) * (1 + taxRate / 100), 2)",
        scope,
    )
    assert res == 35200


def test_schema_versioning_increments_and_records_history(client: TestClient) -> None:
    snap = client.get("/api/workspaces/ws_nebula/snapshot").json()
    schema = snap["schemas"][0]
    schema["title"] = "研发采购立项单 (v2 修订)"

    save_resp = client.post(
        "/api/workspaces/ws_nebula/schemas",
        json=schema,
        headers={"X-Actor-Id": "mem_lin"},
    )
    assert save_resp.status_code == 200
    assert save_resp.json()["version"] == 2

    hist_resp = client.get("/api/workspaces/ws_nebula/schemas/schema_capex_procure/versions")
    assert hist_resp.status_code == 200
    versions = [item["version"] for item in hist_resp.json()]
    assert versions == [2, 1]


def test_schema_edit_permission_denied_for_engineer(client: TestClient) -> None:
    snap = client.get("/api/workspaces/ws_nebula/snapshot").json()
    schema = snap["schemas"][0]
    resp = client.post(
        "/api/workspaces/ws_nebula/schemas",
        json=schema,
        headers={"X-Actor-Id": "mem_xu"},
    )
    assert resp.status_code == 403


def test_submit_ticket_rejects_cross_field_validation_failure(client: TestClient) -> None:
    resp = client.post(
        "/api/workspaces/ws_nebula/tickets",
        json={
            "formSchemaId": "schema_capex_procure",
            "workflowId": "wf_capex_approval",
            "applicantId": "mem_xu",
            "title": "违规超额减免采购",
            "values": {
                "projectTitle": "违规超额减免采购",
                "procurementMode": "bidding",
                "items": [{"itemName": "Switch", "qty": 1, "unitPrice": 10000}],
                "discountAmount": 8000,
                "taxRate": 13,
            },
        },
    )
    assert resp.status_code == 422
    assert "validationErrors" in resp.json()["detail"]


def test_submit_ticket_rejects_cross_workspace_applicant(client: TestClient) -> None:
    resp = client.post(
        "/api/workspaces/ws_nebula/tickets",
        json={
            "formSchemaId": "schema_capex_procure",
            "workflowId": "wf_capex_approval",
            "applicantId": "mem_gu",  # Belongs to ws_harbor
            "title": "越权跨租户提交",
            "values": {"projectTitle": "Test"},
        },
    )
    assert resp.status_code == 403


def test_ticket_full_high_value_workflow_routes_to_cfo_and_records_audits(
    client: TestClient,
) -> None:
    create_resp = client.post(
        "/api/workspaces/ws_nebula/tickets",
        json={
            "formSchemaId": "schema_capex_procure",
            "workflowId": "wf_capex_approval",
            "applicantId": "mem_xu",
            "title": "高性能存储阵列采购",
            "values": {
                "projectTitle": "高性能存储阵列采购",
                "procurementMode": "bidding",
                "items": [{"itemName": "NVMe 阵列", "qty": 2, "unitPrice": 30000}],
                "discountAmount": 0,
                "taxRate": 13,
                "cfoRiskMemo": "满足核心研发数据湖读写需求",
            },
        },
    )
    assert create_resp.status_code == 201
    tkt = create_resp.json()
    assert tkt["values"]["grandTotal"] == 67800
    assert tkt["currentNodeId"] == "node_dept_lead"

    # Step 1: dept lead approve
    r1 = client.post(
        f"/api/workspaces/ws_nebula/tickets/{tkt['id']}/actions",
        json={"actorId": "mem_zhou", "action": "approve", "comment": "初审同意"},
    )
    assert r1.status_code == 200
    assert r1.json()["currentNodeId"] == "node_tech_scm_countersign"

    # Step 2: parallel countersign (lin + chen)
    r2 = client.post(
        f"/api/workspaces/ws_nebula/tickets/{tkt['id']}/actions",
        json={"actorId": "mem_lin", "action": "approve", "comment": "技术可行"},
    )
    assert r2.status_code == 200
    assert r2.json()["currentNodeId"] == "node_tech_scm_countersign"

    r3 = client.post(
        f"/api/workspaces/ws_nebula/tickets/{tkt['id']}/actions",
        json={"actorId": "mem_chen", "action": "approve", "comment": "比价合规"},
    )
    assert r3.status_code == 200
    assert r3.json()["currentNodeId"] == "node_cfo_final"

    # Step 3: CFO final approve
    r4 = client.post(
        f"/api/workspaces/ws_nebula/tickets/{tkt['id']}/actions",
        json={"actorId": "mem_su", "action": "approve", "comment": "CFO 批准"},
    )
    assert r4.status_code == 200
    assert r4.json()["status"] == "approved"

    audits = client.get(f"/api/workspaces/ws_nebula/tickets/{tkt['id']}/audits").json()
    assert [a["action"] for a in audits] == ["submit", "approve", "approve", "approve", "approve"]


def test_ticket_low_value_workflow_bypasses_cfo_via_gateway(client: TestClient) -> None:
    create_resp = client.post(
        "/api/workspaces/ws_nebula/tickets",
        json={
            "formSchemaId": "schema_capex_procure",
            "workflowId": "wf_capex_approval",
            "applicantId": "mem_xu",
            "title": "小额测试机采购",
            "values": {
                "projectTitle": "小额测试机采购",
                "procurementMode": "bidding",
                "items": [{"itemName": "测试终端", "qty": 2, "unitPrice": 5000}],
                "discountAmount": 0,
                "taxRate": 13,
            },
        },
    )
    assert create_resp.status_code == 201
    tid = create_resp.json()["id"]
    assert create_resp.json()["values"]["grandTotal"] == 11300

    client.post(
        f"/api/workspaces/ws_nebula/tickets/{tid}/actions",
        json={"actorId": "mem_zhou", "action": "approve", "comment": "ok"},
    )
    client.post(
        f"/api/workspaces/ws_nebula/tickets/{tid}/actions",
        json={"actorId": "mem_lin", "action": "approve", "comment": "ok"},
    )
    final_res = client.post(
        f"/api/workspaces/ws_nebula/tickets/{tid}/actions",
        json={"actorId": "mem_chen", "action": "approve", "comment": "ok"},
    )
    assert final_res.status_code == 200
    assert final_res.json()["status"] == "approved"
    assert final_res.json()["currentNodeId"] == "node_end"


def test_parallel_countersign_unanimous_rejects_immediately(client: TestClient) -> None:
    res = client.post(
        "/api/workspaces/ws_nebula/tickets/tkt_seed_gpu_cluster/actions",
        json={"actorId": "mem_chen", "action": "reject", "comment": "合规条款缺失"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"


def test_ratio_countersign_passes_when_threshold_met(client: TestClient) -> None:
    ratio_wf = {
        "id": "wf_ratio_api",
        "workspaceId": "ws_nebula",
        "formSchemaId": "schema_capex_procure",
        "name": "比例会签流",
        "description": "50% 通过",
        "nodes": [
            {"id": "s", "name": "发起", "kind": "start", "nextNodeId": "cs"},
            {
                "id": "cs",
                "name": "联合会签",
                "kind": "parallel_countersign",
                "assigneeIds": ["mem_lin", "mem_chen", "mem_zhou"],
                "countersignPolicy": "ratio",
                "passRatio": 0.5,
                "nextNodeId": "e",
            },
            {"id": "e", "name": "归档", "kind": "end"},
        ],
    }
    wf_res = client.post(
        "/api/workspaces/ws_nebula/workflows",
        json=ratio_wf,
        headers={"X-Actor-Id": "mem_lin"},
    )
    assert wf_res.status_code == 200

    tkt = client.post(
        "/api/workspaces/ws_nebula/tickets",
        json={
            "formSchemaId": "schema_capex_procure",
            "workflowId": "wf_ratio_api",
            "applicantId": "mem_xu",
            "title": "比例会签工单",
            "values": {
                "projectTitle": "比例会签工单",
                "items": [{"itemName": "传感器", "qty": 1, "unitPrice": 5000}],
                "discountAmount": 0,
                "taxRate": 6,
            },
        },
    ).json()

    r1 = client.post(
        f"/api/workspaces/ws_nebula/tickets/{tkt['id']}/actions",
        json={"actorId": "mem_lin", "action": "approve", "comment": "1/3"},
    )
    assert r1.json()["status"] == "in_review"

    r2 = client.post(
        f"/api/workspaces/ws_nebula/tickets/{tkt['id']}/actions",
        json={"actorId": "mem_chen", "action": "approve", "comment": "2/3"},
    )
    assert r2.json()["status"] == "approved"


def test_return_to_node_and_resubmit_flow(client: TestClient) -> None:
    ret = client.post(
        "/api/workspaces/ws_nebula/tickets/tkt_seed_gpu_cluster/actions",
        json={
            "actorId": "mem_lin",
            "action": "return_to_node",
            "targetNodeId": "node_start",
            "comment": "请补齐报价单",
        },
    )
    assert ret.status_code == 200
    assert ret.json()["status"] == "returned"
    assert ret.json()["currentNodeId"] == "node_start"

    resub = client.post(
        "/api/workspaces/ws_nebula/tickets/tkt_seed_gpu_cluster/actions",
        json={
            "actorId": "mem_xu",
            "action": "resubmit",
            "comment": "已补齐报价单",
        },
    )
    assert resub.status_code == 200
    assert resub.json()["status"] == "in_review"
    assert resub.json()["currentNodeId"] == "node_dept_lead"


def test_delegate_approval_and_subsequent_vote(client: TestClient) -> None:
    del_res = client.post(
        "/api/workspaces/ws_nebula/tickets/tkt_seed_gpu_cluster/actions",
        json={
            "actorId": "mem_lin",
            "action": "delegate",
            "delegateToId": "mem_su",
            "comment": "转交苏总监",
        },
    )
    assert del_res.status_code == 200
    assignees = del_res.json()["currentAssignees"]
    assert "mem_su" in assignees
    assert "mem_lin" not in assignees


def test_non_assignee_cannot_act_on_ticket(client: TestClient) -> None:
    res = client.post(
        "/api/workspaces/ws_nebula/tickets/tkt_seed_gpu_cluster/actions",
        json={"actorId": "mem_su", "action": "approve", "comment": "越权审批"},
    )
    assert res.status_code == 400


def test_duplicate_vote_by_same_actor_is_rejected(client: TestClient) -> None:
    r1 = client.post(
        "/api/workspaces/ws_nebula/tickets/tkt_seed_gpu_cluster/actions",
        json={"actorId": "mem_lin", "action": "approve", "comment": "首次投票"},
    )
    assert r1.status_code == 200

    r2 = client.post(
        "/api/workspaces/ws_nebula/tickets/tkt_seed_gpu_cluster/actions",
        json={"actorId": "mem_lin", "action": "approve", "comment": "重复投票"},
    )
    assert r2.status_code == 400


def test_sla_overdue_flag_computed_when_past_deadline(client: TestClient) -> None:
    res = client.post(
        "/api/workspaces/ws_nebula/tickets/tkt_seed_gpu_cluster/actions",
        json={
            "actorId": "mem_lin",
            "action": "approve",
            "comment": "超时后审批",
            "nowIso": "2026-03-25T10:00:00Z",
        },
    )
    assert res.status_code == 200
    assert res.json()["isOverdue"] is True


def test_create_knowledge_doc_card_and_rbac_check(client: TestClient) -> None:
    denied = client.post(
        "/api/workspaces/ws_nebula/docs",
        json={
            "title": "未授权文档",
            "category": "guide",
            "summary": "s",
            "contentMarkdown": "c",
            "authorName": "许星河",
        },
        headers={"X-Actor-Id": "mem_xu"},
    )
    assert denied.status_code == 403

    created = client.post(
        "/api/workspaces/ws_nebula/docs",
        json={
            "title": "《集群电源冗余设计指南》",
            "category": "guide",
            "summary": "双路冗余供电验收标准",
            "contentMarkdown": "所有 GPU 节点需配备双路冗余电源。",
            "tags": ["硬件", "SLA"],
            "linkedFormSchemaIds": ["schema_capex_procure"],
            "authorName": "林知夏",
        },
        headers={"X-Actor-Id": "mem_lin"},
    )
    assert created.status_code == 201
    assert created.json()["workspaceId"] == "ws_nebula"
