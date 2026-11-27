"""
Multi-stage workflow state engine for OrgFlow Studio backend.
Supports serial approval, parallel countersign (unanimous & ratio),
condition gateway routing, return-to-node, delegation, resubmit, SLA overdue check, and immutable audit logs.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from .expression_engine import evaluate_safe_expression


class WorkflowTransitionError(ValueError):
    """Raised when a workflow state transition violates state, permission, or routing rules."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso(ts: str) -> datetime:
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts)


def compute_sla_deadline(node: dict[str, Any], entered_iso: str) -> str | None:
    sla_hours = node.get("slaHours")
    if not sla_hours or sla_hours <= 0:
        return None
    dt = parse_iso(entered_iso) + timedelta(hours=float(sla_hours))
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def is_ticket_overdue(ticket: dict[str, Any], now_iso: str | None = None) -> bool:
    if ticket.get("status") != "in_review":
        return False
    deadline = ticket.get("slaDeadlineAt")
    if not deadline:
        return False
    ref = parse_iso(now_iso) if now_iso else datetime.now(timezone.utc)
    return ref > parse_iso(deadline)


def find_node(workflow: dict[str, Any], node_id: str) -> dict[str, Any]:
    for node in workflow.get("nodes", []):
        if node["id"] == node_id:
            return node
    raise WorkflowTransitionError(f"Workflow node '{node_id}' not found")


def resolve_reachable_node(
    workflow: dict[str, Any],
    candidate_node_id: str,
    values: dict[str, Any],
    hops: int = 0,
) -> dict[str, Any]:
    if hops > 12:
        raise WorkflowTransitionError("Condition routing cycle detected")
    node = find_node(workflow, candidate_node_id)
    if node["kind"] != "condition_gateway":
        return node

    branches = sorted(node.get("branches", []), key=lambda b: b.get("priority", 99))
    for br in branches:
        expr = br.get("expression", "")
        if expr and bool(evaluate_safe_expression(expr, values)):
            return resolve_reachable_node(workflow, br["targetNodeId"], values, hops + 1)

    default_next = node.get("defaultNextNodeId")
    if default_next:
        return resolve_reachable_node(workflow, default_next, values, hops + 1)
    raise WorkflowTransitionError(f"Gateway '{node['name']}' matched no branch")


def make_audit_entry(
    *,
    ticket_id: str,
    workspace_id: str,
    node_id: str,
    node_name: str,
    actor: dict[str, Any],
    action: str,
    comment: str,
    created_at: str,
    target_node_id: str | None = None,
    delegate_to_id: str | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": f"aud_{uuid.uuid4().hex[:10]}",
        "ticketId": ticket_id,
        "workspaceId": workspace_id,
        "nodeId": node_id,
        "nodeName": node_name,
        "actorId": actor["id"],
        "actorName": actor["name"],
        "action": action,
        "comment": comment,
        "createdAt": created_at,
    }
    if target_node_id:
        entry["targetNodeId"] = target_node_id
    if delegate_to_id:
        entry["delegateToId"] = delegate_to_id
    return entry


def build_new_ticket(
    *,
    ticket_id: str | None = None,
    workspace_id: str,
    form_schema_id: str,
    form_version: int,
    workflow: dict[str, Any],
    title: str,
    applicant: dict[str, Any],
    values: dict[str, Any],
    now_iso: str | None = None,
) -> dict[str, Any]:
    now = now_iso or utc_now_iso()
    start_node = next((n for n in workflow["nodes"] if n["kind"] == "start"), None)
    if not start_node or not start_node.get("nextNodeId"):
        raise WorkflowTransitionError("Workflow is missing a valid start node")

    first_node = resolve_reachable_node(workflow, start_node["nextNodeId"], values)
    tid = ticket_id or f"tkt_{uuid.uuid4().hex[:10]}"
    immediate_end = first_node["kind"] == "end"
    deadline = None if immediate_end else compute_sla_deadline(first_node, now)

    audit = make_audit_entry(
        ticket_id=tid,
        workspace_id=workspace_id,
        node_id=start_node["id"],
        node_name=start_node["name"],
        actor=applicant,
        action="submit",
        comment="提交表单并发起审批流",
        created_at=now,
        target_node_id=first_node["id"],
    )

    return {
        "id": tid,
        "workspaceId": workspace_id,
        "formSchemaId": form_schema_id,
        "formVersion": form_version,
        "workflowId": workflow["id"],
        "title": title,
        "applicantId": applicant["id"],
        "applicantName": applicant["name"],
        "status": "approved" if immediate_end else "in_review",
        "currentNodeId": first_node["id"],
        "currentAssignees": [] if immediate_end else list(first_node.get("assigneeIds", [])),
        "nodeVotes": {},
        "values": values,
        "nodeEnteredAt": now,
        "slaDeadlineAt": deadline,
        "isOverdue": False,
        "createdAt": now,
        "updatedAt": now,
        "auditLogs": [audit],
    }


def apply_ticket_transition(
    *,
    ticket: dict[str, Any],
    workflow: dict[str, Any],
    actor: dict[str, Any],
    action: str,
    comment: str,
    target_node_id: str | None = None,
    delegate_to: dict[str, Any] | None = None,
    updated_values: dict[str, Any] | None = None,
    now_iso: str | None = None,
) -> dict[str, Any]:
    now = now_iso or utc_now_iso()
    if ticket["workspaceId"] != workflow["workspaceId"] or actor["workspaceId"] != ticket["workspaceId"]:
        raise WorkflowTransitionError("Cross-workspace workflow access denied")

    current_node = find_node(workflow, ticket["currentNodeId"])

    if action == "resubmit":
        if ticket["status"] != "returned":
            raise WorkflowTransitionError("Only returned tickets can be resubmitted")
        next_values = updated_values if updated_values is not None else ticket["values"]
        start_node = next((n for n in workflow["nodes"] if n["kind"] == "start"), None)
        entry_id = (
            start_node["nextNodeId"]
            if current_node["kind"] == "start" and start_node and start_node.get("nextNodeId")
            else current_node["id"]
        )
        resolved = resolve_reachable_node(workflow, entry_id, next_values)
        is_end = resolved["kind"] == "end"
        audit = make_audit_entry(
            ticket_id=ticket["id"],
            workspace_id=ticket["workspaceId"],
            node_id=current_node["id"],
            node_name=current_node["name"],
            actor=actor,
            action="resubmit",
            comment=comment or "补充材料后重新提交",
            created_at=now,
            target_node_id=resolved["id"],
        )
        node_votes = dict(ticket.get("nodeVotes", {}))
        node_votes[resolved["id"]] = []
        return {
            **ticket,
            "values": next_values,
            "status": "approved" if is_end else "in_review",
            "currentNodeId": resolved["id"],
            "currentAssignees": [] if is_end else list(resolved.get("assigneeIds", [])),
            "nodeVotes": node_votes,
            "nodeEnteredAt": now,
            "slaDeadlineAt": None if is_end else compute_sla_deadline(resolved, now),
            "isOverdue": False,
            "updatedAt": now,
            "auditLogs": [*ticket["auditLogs"], audit],
        }

    if ticket["status"] != "in_review":
        raise WorkflowTransitionError(f"Ticket in status '{ticket['status']}' cannot accept '{action}'")

    if actor["id"] not in ticket.get("currentAssignees", []):
        raise WorkflowTransitionError(f"Member '{actor['id']}' is not an active assignee on '{current_node['id']}'")

    if action == "delegate":
        if not delegate_to:
            raise WorkflowTransitionError("delegateTo member is required")
        if delegate_to["workspaceId"] != ticket["workspaceId"]:
            raise WorkflowTransitionError("Cross-workspace delegation is forbidden")
        replaced = [delegate_to["id"] if aid == actor["id"] else aid for aid in ticket["currentAssignees"]]
        dedup = list(dict.fromkeys(replaced))
        audit = make_audit_entry(
            ticket_id=ticket["id"],
            workspace_id=ticket["workspaceId"],
            node_id=current_node["id"],
            node_name=current_node["name"],
            actor=actor,
            action="delegate",
            comment=comment or f"转交审批给 {delegate_to['name']}",
            created_at=now,
            delegate_to_id=delegate_to["id"],
        )
        return {
            **ticket,
            "currentAssignees": dedup,
            "isOverdue": is_ticket_overdue(ticket, now),
            "updatedAt": now,
            "auditLogs": [*ticket["auditLogs"], audit],
        }

    if action == "return_to_node":
        start_node = next((n for n in workflow["nodes"] if n["kind"] == "start"), None)
        dest_id = target_node_id or (start_node["id"] if start_node else None)
        if not dest_id:
            raise WorkflowTransitionError("Target node id required for return_to_node")
        allowed = current_node.get("allowReturnToNodeIds")
        if allowed and dest_id not in allowed:
            raise WorkflowTransitionError(f"Return to node '{dest_id}' is not permitted from '{current_node['id']}'")
        dest_node = find_node(workflow, dest_id)
        back_to_start = dest_node["kind"] == "start"
        next_assignees = (
            [ticket["applicantId"]]
            if back_to_start
            else list(dest_node.get("assigneeIds") or [ticket["applicantId"]])
        )
        node_votes = dict(ticket.get("nodeVotes", {}))
        node_votes[current_node["id"]] = []
        node_votes[dest_node["id"]] = []
        audit = make_audit_entry(
            ticket_id=ticket["id"],
            workspace_id=ticket["workspaceId"],
            node_id=current_node["id"],
            node_name=current_node["name"],
            actor=actor,
            action="return_to_node",
            comment=comment or f"退回至节点 {dest_node['name']}",
            created_at=now,
            target_node_id=dest_node["id"],
        )
        return {
            **ticket,
            "status": "returned" if back_to_start else "in_review",
            "currentNodeId": dest_node["id"],
            "currentAssignees": next_assignees,
            "nodeVotes": node_votes,
            "nodeEnteredAt": now,
            "slaDeadlineAt": None if back_to_start else compute_sla_deadline(dest_node, now),
            "isOverdue": False,
            "updatedAt": now,
            "auditLogs": [*ticket["auditLogs"], audit],
        }

    if action not in ("approve", "reject"):
        raise WorkflowTransitionError(f"Unsupported workflow action '{action}'")

    existing_votes = list(ticket.get("nodeVotes", {}).get(current_node["id"], []))
    if any(v["actorId"] == actor["id"] for v in existing_votes):
        raise WorkflowTransitionError("Actor has already voted on this node")

    existing_votes.append(
        {
            "actorId": actor["id"],
            "actorName": actor["name"],
            "decision": action,
            "comment": comment,
            "actedAt": now,
        }
    )
    node_votes = dict(ticket.get("nodeVotes", {}))
    node_votes[current_node["id"]] = existing_votes

    total_slots = max(1, len(current_node.get("assigneeIds") or ticket["currentAssignees"]))
    approves = sum(1 for v in existing_votes if v["decision"] == "approve")
    rejects = sum(1 for v in existing_votes if v["decision"] == "reject")

    passed = False
    rejected = False

    if current_node["kind"] == "serial_approval":
        passed = action == "approve"
        rejected = action == "reject"
    elif current_node["kind"] == "parallel_countersign":
        policy = current_node.get("countersignPolicy", "unanimous")
        req_ratio = 1.0 if policy == "unanimous" else float(current_node.get("passRatio", 1.0))
        if policy == "unanimous":
            if rejects > 0:
                rejected = True
            elif approves >= total_slots:
                passed = True
        else:
            if (approves / total_slots) >= req_ratio:
                passed = True
            elif ((total_slots - rejects) / total_slots) < req_ratio:
                rejected = True

    audit = make_audit_entry(
        ticket_id=ticket["id"],
        workspace_id=ticket["workspaceId"],
        node_id=current_node["id"],
        node_name=current_node["name"],
        actor=actor,
        action=action,
        comment=comment,
        created_at=now,
    )

    if rejected:
        return {
            **ticket,
            "status": "rejected",
            "currentAssignees": [],
            "nodeVotes": node_votes,
            "slaDeadlineAt": None,
            "isOverdue": False,
            "updatedAt": now,
            "auditLogs": [*ticket["auditLogs"], audit],
        }

    if not passed:
        voted_ids = {v["actorId"] for v in existing_votes}
        remaining = [
            aid
            for aid in (current_node.get("assigneeIds") or ticket["currentAssignees"])
            if aid not in voted_ids
        ]
        return {
            **ticket,
            "currentAssignees": remaining,
            "nodeVotes": node_votes,
            "isOverdue": is_ticket_overdue(ticket, now),
            "updatedAt": now,
            "auditLogs": [*ticket["auditLogs"], audit],
        }

    next_id = current_node.get("nextNodeId")
    if not next_id:
        return {
            **ticket,
            "status": "approved",
            "currentAssignees": [],
            "nodeVotes": node_votes,
            "slaDeadlineAt": None,
            "isOverdue": False,
            "updatedAt": now,
            "auditLogs": [*ticket["auditLogs"], audit],
        }

    resolved_next = resolve_reachable_node(workflow, next_id, ticket["values"])
    reached_end = resolved_next["kind"] == "end"
    node_votes[resolved_next["id"]] = []
    audit["targetNodeId"] = resolved_next["id"]

    return {
        **ticket,
        "status": "approved" if reached_end else "in_review",
        "currentNodeId": resolved_next["id"],
        "currentAssignees": [] if reached_end else list(resolved_next.get("assigneeIds", [])),
        "nodeVotes": node_votes,
        "nodeEnteredAt": now,
        "slaDeadlineAt": None if reached_end else compute_sla_deadline(resolved_next, now),
        "isOverdue": False,
        "updatedAt": now,
        "auditLogs": [*ticket["auditLogs"], audit],
    }
