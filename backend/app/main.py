"""
OrgFlow Studio FastAPI Service Entrypoint.
Provides multi-tenant workspace isolation, versioned JSON Schema storage,
AST-validated ticket submission, multi-sign/conditional workflow execution, and audit trails.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .database import connect_db, init_schema_and_seed, persist_ticket_with_audits
from .expression_engine import SafeExpressionError, evaluate_and_validate_form
from .workflow_service import (
    WorkflowTransitionError,
    apply_ticket_transition,
    build_new_ticket,
    is_ticket_overdue,
    utc_now_iso,
)


class SubmitTicketPayload(BaseModel):
    formSchemaId: str
    workflowId: str
    applicantId: str
    title: str
    values: dict[str, Any] = Field(default_factory=dict)
    nowIso: str | None = None


class TicketActionPayload(BaseModel):
    actorId: str
    action: str
    comment: str = ""
    targetNodeId: str | None = None
    delegateToId: str | None = None
    updatedValues: dict[str, Any] | None = None
    nowIso: str | None = None


class CreateDocCardPayload(BaseModel):
    title: str
    category: str = "guide"
    summary: str
    contentMarkdown: str
    tags: list[str] = Field(default_factory=list)
    linkedFormSchemaIds: list[str] = Field(default_factory=list)
    linkedWorkflowIds: list[str] = Field(default_factory=list)
    authorName: str


def create_app(db_path: str | None = None) -> FastAPI:
    conn = connect_db(db_path)
    init_schema_and_seed(conn)

    app = FastAPI(
        title="OrgFlow Studio API",
        version="1.0.0",
        description="Metadata-driven organizational collaboration & dynamic form workflow engine",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def get_conn() -> sqlite3.Connection:
        return conn

    def ensure_workspace(ws_id: str, db: sqlite3.Connection) -> dict[str, Any]:
        row = db.execute("SELECT * FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Workspace '{ws_id}' not found")
        return dict(row)

    def get_member_in_workspace(member_id: str, ws_id: str, db: sqlite3.Connection) -> dict[str, Any]:
        row = db.execute(
            "SELECT * FROM members WHERE id = ? AND workspace_id = ?",
            (member_id, ws_id),
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=403,
                detail=f"Member '{member_id}' does not belong to workspace '{ws_id}'",
            )
        return {
            "id": row["id"],
            "workspaceId": row["workspace_id"],
            "departmentId": row["department_id"],
            "name": row["name"],
            "title": row["title"],
            "email": row["email"],
            "roleIds": json.loads(row["role_ids_json"]),
        }

    def verify_permission(
        actor_id: str | None,
        ws_id: str,
        required_perm: str,
        db: sqlite3.Connection,
    ) -> None:
        if not actor_id:
            return
        member = get_member_in_workspace(actor_id, ws_id, db)
        role_rows = db.execute(
            "SELECT id, permissions_json FROM roles WHERE workspace_id = ?",
            (ws_id,),
        ).fetchall()
        perm_map = {r["id"]: set(json.loads(r["permissions_json"])) for r in role_rows}
        granted: set[str] = set()
        for rid in member["roleIds"]:
            granted |= perm_map.get(rid, set())
        if "org:admin" not in granted and required_perm not in granted:
            raise HTTPException(
                status_code=403,
                detail=f"Actor '{actor_id}' lacks required permission '{required_perm}'",
            )

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "service": "orgflow-studio-backend"}

    @app.get("/api/workspaces")
    def list_workspaces(db: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
        rows = db.execute("SELECT * FROM workspaces ORDER BY id").fetchall()
        return [dict(r) for r in rows]

    @app.get("/api/workspaces/{ws_id}/snapshot")
    def workspace_snapshot(ws_id: str, db: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
        workspace = ensure_workspace(ws_id, db)

        depts = [
            {
                "id": r["id"],
                "workspaceId": r["workspace_id"],
                "name": r["name"],
                "code": r["code"],
                "parentId": r["parent_id"],
            }
            for r in db.execute("SELECT * FROM departments WHERE workspace_id = ?", (ws_id,)).fetchall()
        ]

        roles = [
            {
                "id": r["id"],
                "workspaceId": r["workspace_id"],
                "code": r["code"],
                "name": r["name"],
                "permissions": json.loads(r["permissions_json"]),
            }
            for r in db.execute("SELECT * FROM roles WHERE workspace_id = ?", (ws_id,)).fetchall()
        ]

        members = [
            {
                "id": r["id"],
                "workspaceId": r["workspace_id"],
                "departmentId": r["department_id"],
                "name": r["name"],
                "title": r["title"],
                "email": r["email"],
                "roleIds": json.loads(r["role_ids_json"]),
            }
            for r in db.execute("SELECT * FROM members WHERE workspace_id = ?", (ws_id,)).fetchall()
        ]

        schemas = [
            json.loads(r["payload_json"])
            for r in db.execute("SELECT payload_json FROM form_schemas WHERE workspace_id = ?", (ws_id,)).fetchall()
        ]

        workflows = [
            json.loads(r["payload_json"])
            for r in db.execute("SELECT payload_json FROM workflows WHERE workspace_id = ?", (ws_id,)).fetchall()
        ]

        tickets = []
        for r in db.execute(
            "SELECT payload_json FROM tickets WHERE workspace_id = ? ORDER BY updated_at DESC",
            (ws_id,),
        ).fetchall():
            t = json.loads(r["payload_json"])
            t["isOverdue"] = is_ticket_overdue(t)
            tickets.append(t)

        docs = [
            json.loads(r["payload_json"])
            for r in db.execute(
                "SELECT payload_json FROM knowledge_docs WHERE workspace_id = ? ORDER BY updated_at DESC",
                (ws_id,),
            ).fetchall()
        ]

        return {
            "workspace": workspace,
            "departments": depts,
            "roles": roles,
            "members": members,
            "schemas": schemas,
            "workflows": workflows,
            "tickets": tickets,
            "docs": docs,
        }

    @app.post("/api/workspaces/{ws_id}/schemas")
    def save_schema(
        ws_id: str,
        payload: dict[str, Any],
        x_actor_id: str | None = Header(default=None),
        db: sqlite3.Connection = Depends(get_conn),
    ) -> dict[str, Any]:
        ensure_workspace(ws_id, db)
        verify_permission(x_actor_id, ws_id, "schema:edit", db)

        schema_id = payload.get("id") or f"schema_{uuid.uuid4().hex[:8]}"
        cur_row = db.execute(
            "SELECT version FROM form_schemas WHERE id = ? AND workspace_id = ?",
            (schema_id, ws_id),
        ).fetchone()
        next_version = (cur_row["version"] + 1) if cur_row else 1
        now = utc_now_iso()

        saved_schema = {
            **payload,
            "id": schema_id,
            "workspaceId": ws_id,
            "version": next_version,
            "updatedAt": now,
        }
        serialized = json.dumps(saved_schema, ensure_ascii=False)
        db.execute(
            """
            INSERT INTO form_schemas (id, workspace_id, version, payload_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id, workspace_id) DO UPDATE SET
                version = excluded.version,
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
            """,
            (schema_id, ws_id, next_version, serialized, now),
        )
        db.execute(
            "INSERT INTO form_schema_versions VALUES (?, ?, ?, ?, ?)",
            (schema_id, ws_id, next_version, serialized, now),
        )
        db.commit()
        return saved_schema

    @app.get("/api/workspaces/{ws_id}/schemas/{schema_id}/versions")
    def list_schema_versions(
        ws_id: str,
        schema_id: str,
        db: sqlite3.Connection = Depends(get_conn),
    ) -> list[dict[str, Any]]:
        ensure_workspace(ws_id, db)
        rows = db.execute(
            """
            SELECT version, saved_at, payload_json
            FROM form_schema_versions
            WHERE workspace_id = ? AND schema_id = ?
            ORDER BY version DESC
            """,
            (ws_id, schema_id),
        ).fetchall()
        return [
            {"version": r["version"], "savedAt": r["saved_at"], "schema": json.loads(r["payload_json"])}
            for r in rows
        ]

    @app.post("/api/workspaces/{ws_id}/workflows")
    def save_workflow(
        ws_id: str,
        payload: dict[str, Any],
        x_actor_id: str | None = Header(default=None),
        db: sqlite3.Connection = Depends(get_conn),
    ) -> dict[str, Any]:
        ensure_workspace(ws_id, db)
        verify_permission(x_actor_id, ws_id, "workflow:manage", db)

        wf_id = payload.get("id") or f"wf_{uuid.uuid4().hex[:8]}"
        cur_row = db.execute(
            "SELECT version FROM workflows WHERE id = ? AND workspace_id = ?",
            (wf_id, ws_id),
        ).fetchone()
        next_version = (cur_row["version"] + 1) if cur_row else 1
        saved = {**payload, "id": wf_id, "workspaceId": ws_id, "version": next_version}
        db.execute(
            """
            INSERT INTO workflows (id, workspace_id, version, payload_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id, workspace_id) DO UPDATE SET
                version = excluded.version,
                payload_json = excluded.payload_json
            """,
            (wf_id, ws_id, next_version, json.dumps(saved, ensure_ascii=False)),
        )
        db.commit()
        return saved

    @app.post("/api/workspaces/{ws_id}/tickets", status_code=201)
    def create_ticket(
        ws_id: str,
        body: SubmitTicketPayload,
        db: sqlite3.Connection = Depends(get_conn),
    ) -> dict[str, Any]:
        ensure_workspace(ws_id, db)
        applicant = get_member_in_workspace(body.applicantId, ws_id, db)
        verify_permission(body.applicantId, ws_id, "ticket:submit", db)

        sc_row = db.execute(
            "SELECT payload_json FROM form_schemas WHERE id = ? AND workspace_id = ?",
            (body.formSchemaId, ws_id),
        ).fetchone()
        wf_row = db.execute(
            "SELECT payload_json FROM workflows WHERE id = ? AND workspace_id = ?",
            (body.workflowId, ws_id),
        ).fetchone()
        if not sc_row or not wf_row:
            raise HTTPException(status_code=404, detail="Form schema or workflow not found in workspace")

        schema = json.loads(sc_row["payload_json"])
        workflow = json.loads(wf_row["payload_json"])

        try:
            evaluated_vals, errors = evaluate_and_validate_form(schema, body.values)
        except SafeExpressionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if errors:
            raise HTTPException(status_code=422, detail={"validationErrors": errors})

        try:
            ticket = build_new_ticket(
                workspace_id=ws_id,
                form_schema_id=schema["id"],
                form_version=schema["version"],
                workflow=workflow,
                title=body.title,
                applicant=applicant,
                values=evaluated_vals,
                now_iso=body.nowIso,
            )
        except WorkflowTransitionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        persist_ticket_with_audits(db, ticket)
        db.commit()
        return ticket

    @app.post("/api/workspaces/{ws_id}/tickets/{ticket_id}/actions")
    def act_on_ticket(
        ws_id: str,
        ticket_id: str,
        body: TicketActionPayload,
        db: sqlite3.Connection = Depends(get_conn),
    ) -> dict[str, Any]:
        ensure_workspace(ws_id, db)
        t_row = db.execute(
            "SELECT payload_json FROM tickets WHERE id = ? AND workspace_id = ?",
            (ticket_id, ws_id),
        ).fetchone()
        if not t_row:
            raise HTTPException(status_code=404, detail="Ticket not found in workspace")

        ticket = json.loads(t_row["payload_json"])
        actor = get_member_in_workspace(body.actorId, ws_id, db)
        if body.action != "resubmit":
            verify_permission(body.actorId, ws_id, "ticket:approve", db)

        wf_row = db.execute(
            "SELECT payload_json FROM workflows WHERE id = ? AND workspace_id = ?",
            (ticket["workflowId"], ws_id),
        ).fetchone()
        if not wf_row:
            raise HTTPException(status_code=404, detail="Associated workflow not found")
        workflow = json.loads(wf_row["payload_json"])

        delegate_member = None
        if body.delegateToId:
            delegate_member = get_member_in_workspace(body.delegateToId, ws_id, db)

        updated_vals = body.updatedValues
        if updated_vals is not None:
            sc_row = db.execute(
                "SELECT payload_json FROM form_schemas WHERE id = ? AND workspace_id = ?",
                (ticket["formSchemaId"], ws_id),
            ).fetchone()
            if sc_row:
                updated_vals, val_errors = evaluate_and_validate_form(
                    json.loads(sc_row["payload_json"]), updated_vals
                )
                if val_errors:
                    raise HTTPException(status_code=422, detail={"validationErrors": val_errors})

        try:
            updated_ticket = apply_ticket_transition(
                ticket=ticket,
                workflow=workflow,
                actor=actor,
                action=body.action,
                comment=body.comment,
                target_node_id=body.targetNodeId,
                delegate_to=delegate_member,
                updated_values=updated_vals,
                now_iso=body.nowIso,
            )
        except WorkflowTransitionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        persist_ticket_with_audits(db, updated_ticket)
        db.commit()
        updated_ticket["isOverdue"] = is_ticket_overdue(updated_ticket, body.nowIso)
        return updated_ticket

    @app.get("/api/workspaces/{ws_id}/tickets/{ticket_id}/audits")
    def list_ticket_audits(
        ws_id: str,
        ticket_id: str,
        db: sqlite3.Connection = Depends(get_conn),
    ) -> list[dict[str, Any]]:
        ensure_workspace(ws_id, db)
        rows = db.execute(
            """
            SELECT payload_json FROM audit_logs
            WHERE workspace_id = ? AND ticket_id = ?
            ORDER BY created_at ASC
            """,
            (ws_id, ticket_id),
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="No audit logs found for ticket in workspace")
        return [json.loads(r["payload_json"]) for r in rows]

    @app.post("/api/workspaces/{ws_id}/docs", status_code=201)
    def create_doc_card(
        ws_id: str,
        body: CreateDocCardPayload,
        x_actor_id: str | None = Header(default=None),
        db: sqlite3.Connection = Depends(get_conn),
    ) -> dict[str, Any]:
        ensure_workspace(ws_id, db)
        verify_permission(x_actor_id, ws_id, "doc:edit", db)
        now = utc_now_iso()
        doc = {
            "id": f"doc_{uuid.uuid4().hex[:8]}",
            "workspaceId": ws_id,
            **body.model_dump(),
            "updatedAt": now,
        }
        db.execute(
            "INSERT INTO knowledge_docs VALUES (?, ?, ?, ?)",
            (doc["id"], ws_id, json.dumps(doc, ensure_ascii=False), now),
        )
        db.commit()
        return doc

    return app


app = create_app()
