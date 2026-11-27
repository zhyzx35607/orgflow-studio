"""
Safe deterministic expression & form evaluation engine for OrgFlow Studio backend.
Uses Python's `ast` syntax tree walker over a strict whitelist — never calls builtin eval/exec.
"""

from __future__ import annotations

import ast
import re
from typing import Any

FORBIDDEN_NAMES = frozenset(
    {"__proto__", "prototype", "constructor", "__class__", "__dict__", "__globals__"}
)


class SafeExpressionError(ValueError):
    """Raised when an expression contains disallowed syntax or identifiers."""


def _normalize_js_expr(expr: str) -> str:
    """Translates JS-style logical tokens (`&&`, `||`, `!`, `true`, `false`, `null`) to Python AST."""
    out: list[str] = []
    i = 0
    n = len(expr)
    while i < n:
        ch = expr[i]
        if ch in ("'", '"'):
            quote = ch
            out.append(ch)
            i += 1
            while i < n:
                cur = expr[i]
                out.append(cur)
                if cur == "\\" and i + 1 < n:
                    i += 1
                    out.append(expr[i])
                elif cur == quote:
                    i += 1
                    break
                i += 1
            continue
        if expr[i : i + 3] == "===":
            out.append("==")
            i += 3
            continue
        if expr[i : i + 3] == "!==":
            out.append("!=")
            i += 3
            continue
        if expr[i : i + 2] == "&&":
            out.append(" and ")
            i += 2
            continue
        if expr[i : i + 2] == "||":
            out.append(" or ")
            i += 2
            continue
        if ch == "!" and expr[i : i + 2] != "!=":
            out.append(" not ")
            i += 1
            continue
        out.append(ch)
        i += 1

    joined = "".join(out)
    joined = re.sub(r"\btrue\b", "True", joined)
    joined = re.sub(r"\bfalse\b", "False", joined)
    joined = re.sub(r"\bnull\b", "None", joined)
    return joined


def _to_num(val: Any) -> float:
    if isinstance(val, bool):
        return 1.0 if val else 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str) and val.strip():
        try:
            return float(val)
        except ValueError:
            return 0.0
    return 0.0


def _extract_series(args: list[Any]) -> list[float]:
    if not args:
        return []
    if isinstance(args[0], list) and len(args) >= 2 and isinstance(args[1], str):
        col = args[1]
        if col in FORBIDDEN_NAMES or col.startswith("_"):
            return []
        return [
            _to_num(row.get(col, 0))
            for row in args[0]
            if isinstance(row, dict)
        ]
    nums: list[float] = []
    for item in args:
        if isinstance(item, list):
            nums.extend(_to_num(x) for x in item)
        else:
            nums.append(_to_num(item))
    return nums


def _call_builtin(name: str, args: list[Any]) -> Any:
    upper = name.upper()
    if upper == "SUM":
        return sum(_extract_series(args))
    if upper == "AVG":
        s = _extract_series(args)
        return (sum(s) / len(s)) if s else 0.0
    if upper == "MIN":
        s = _extract_series(args)
        return min(s) if s else 0.0
    if upper == "MAX":
        s = _extract_series(args)
        return max(s) if s else 0.0
    if upper == "COUNT":
        if args and isinstance(args[0], list):
            return len(args[0])
        return sum(1 for x in args if x not in (None, ""))
    if upper == "ROUND":
        val = _to_num(args[0]) if args else 0.0
        digits = int(_to_num(args[1])) if len(args) > 1 else 2
        digits = max(0, min(8, digits))
        result = round(val, digits)
        return int(result) if result == int(result) else result
    if upper == "ABS":
        return abs(_to_num(args[0])) if args else 0.0
    if upper == "IF":
        cond = bool(args[0]) if args else False
        return (args[1] if len(args) > 1 else None) if cond else (args[2] if len(args) > 2 else None)
    if upper in ("INCLUDES", "CONTAINS"):
        container = args[0] if args else None
        needle = args[1] if len(args) > 1 else None
        if isinstance(container, (list, str)):
            return needle in container
        return False
    if upper == "LEN":
        target = args[0] if args else None
        return len(target) if isinstance(target, (list, str)) else 0
    raise SafeExpressionError(f"Unsupported function '{name}'")


def _eval_node(node: ast.AST, scope: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, scope)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in FORBIDDEN_NAMES or node.id.startswith("__"):
            raise SafeExpressionError(f"Forbidden identifier '{node.id}'")
        return scope.get(node.id)
    if isinstance(node, ast.Attribute):
        if node.attr in FORBIDDEN_NAMES or node.attr.startswith("_"):
            raise SafeExpressionError(f"Forbidden attribute '{node.attr}'")
        target = _eval_node(node.value, scope)
        if isinstance(target, dict):
            return target.get(node.attr)
        if isinstance(target, list):
            return [row.get(node.attr) if isinstance(row, dict) else None for row in target]
        return None
    if isinstance(node, ast.Subscript):
        target = _eval_node(node.value, scope)
        idx = _eval_node(node.slice, scope)
        if isinstance(target, list) and isinstance(idx, int) and 0 <= idx < len(target):
            return target[idx]
        if isinstance(target, dict) and isinstance(idx, str) and not idx.startswith("_"):
            return target.get(idx)
        return None
    if isinstance(node, ast.List):
        return [_eval_node(el, scope) for el in node.elts]
    if isinstance(node, ast.UnaryOp):
        val = _eval_node(node.operand, scope)
        if isinstance(node.op, ast.USub):
            return -_to_num(val)
        if isinstance(node.op, ast.UAdd):
            return _to_num(val)
        if isinstance(node.op, ast.Not):
            return not bool(val)
        raise SafeExpressionError("Unsupported unary operator")
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            for v in node.values:
                if not bool(_eval_node(v, scope)):
                    return False
            return True
        if isinstance(node.op, ast.Or):
            for v in node.values:
                if bool(_eval_node(v, scope)):
                    return True
            return False
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, scope)
        right = _eval_node(node.right, scope)
        if isinstance(node.op, ast.Add):
            if isinstance(left, str) and isinstance(right, str):
                return left + right
            res = _to_num(left) + _to_num(right)
            return int(res) if res == int(res) else res
        if isinstance(node.op, ast.Sub):
            res = _to_num(left) - _to_num(right)
            return int(res) if res == int(res) else res
        if isinstance(node.op, ast.Mult):
            res = _to_num(left) * _to_num(right)
            return int(res) if res == int(res) else res
        if isinstance(node.op, ast.Div):
            denom = _to_num(right)
            return 0.0 if denom == 0 else _to_num(left) / denom
        if isinstance(node.op, ast.Mod):
            denom = _to_num(right)
            return 0.0 if denom == 0 else _to_num(left) % denom
        raise SafeExpressionError("Unsupported binary operator")
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, scope)
        for op, comparator in zip(node.ops, node.comparators):
            right = _eval_node(comparator, scope)
            if isinstance(op, ast.Eq):
                ok = left == right
            elif isinstance(op, ast.NotEq):
                ok = left != right
            elif isinstance(op, ast.Gt):
                ok = _to_num(left) > _to_num(right)
            elif isinstance(op, ast.GtE):
                ok = _to_num(left) >= _to_num(right)
            elif isinstance(op, ast.Lt):
                ok = _to_num(left) < _to_num(right)
            elif isinstance(op, ast.LtE):
                ok = _to_num(left) <= _to_num(right)
            else:
                raise SafeExpressionError("Unsupported comparison operator")
            if not ok:
                return False
            left = right
        return True
    if isinstance(node, ast.IfExp):
        return (
            _eval_node(node.body, scope)
            if bool(_eval_node(node.test, scope))
            else _eval_node(node.orelse, scope)
        )
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise SafeExpressionError("Only direct whitelisted function calls are allowed")
        args = [_eval_node(a, scope) for a in node.args]
        return _call_builtin(node.func.id, args)

    raise SafeExpressionError(f"Disallowed AST construct: {type(node).__name__}")


def evaluate_safe_expression(expression: str, scope: dict[str, Any]) -> Any:
    if not expression or not expression.strip():
        return None
    normalized = _normalize_js_expr(expression.strip())
    try:
        parsed = ast.parse(normalized, mode="eval")
    except SyntaxError as exc:
        raise SafeExpressionError(f"Invalid expression syntax: {exc.msg}") from exc
    return _eval_node(parsed, scope)


def evaluate_and_validate_form(schema: dict[str, Any], raw_values: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    values: dict[str, Any] = dict(raw_values)
    fields: list[dict[str, Any]] = schema.get("fields", [])

    for f in fields:
        key = f["key"]
        if key not in values:
            if "defaultValue" in f and f["defaultValue"] is not None:
                values[key] = f["defaultValue"]
            elif f["type"] in ("number", "currency"):
                values[key] = 0
            elif f["type"] in ("multiselect", "subtable"):
                values[key] = []
            else:
                values[key] = ""

    # Subtable row formulas
    for f in fields:
        if f["type"] == "subtable" and isinstance(values.get(f["key"]), list):
            next_rows = []
            for row in values[f["key"]]:
                row_copy = dict(row) if isinstance(row, dict) else {}
                for col in f.get("columns", []):
                    expr = col.get("computedExpr")
                    if expr:
                        row_scope = {**values, **row_copy, "row": row_copy}
                        row_copy[col["key"]] = evaluate_safe_expression(expr, row_scope)
                next_rows.append(row_copy)
            values[f["key"]] = next_rows

    # Top-level formulas (2 passes)
    for _ in range(2):
        for f in fields:
            expr = f.get("computedExpr")
            if expr:
                values[f["key"]] = evaluate_safe_expression(expr, values)

    errors: list[str] = []
    for f in fields:
        vis_expr = f.get("visibleWhen")
        visible = True if not vis_expr else bool(evaluate_safe_expression(vis_expr, values))
        if not visible:
            continue
        val = values.get(f["key"])
        is_empty = val is None or (isinstance(val, str) and not val.strip()) or (
            f["type"] in ("multiselect", "subtable") and (not isinstance(val, list) or len(val) == 0)
        )
        if f.get("required") and is_empty:
            errors.append(f"字段「{f['label']}」为必填项")
            continue
        if not is_empty and f["type"] in ("number", "currency"):
            num = _to_num(val)
            if f.get("min") is not None and num < f["min"]:
                errors.append(f"字段「{f['label']}」不能小于 {f['min']}")
            if f.get("max") is not None and num > f["max"]:
                errors.append(f"字段「{f['label']}」不能大于 {f['max']}")

    for rule in schema.get("crossFieldRules", []):
        cond = rule.get("conditionExpr")
        if cond and not bool(evaluate_safe_expression(cond, values)):
            errors.append(rule.get("errorMessage", "跨字段校验未通过"))

    return values, errors
