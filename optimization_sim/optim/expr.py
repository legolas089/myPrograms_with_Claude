"""Safe formula parser: text -> CasADi SX expression.

Used for the custom objective ("sin(x)*y + x^2") and for constraints written
as inequalities ("x^2 + y^2 <= 1", "x + y = 1"). Only arithmetic, a fixed set
of functions and the variables x (and y in 2-D) are allowed; anything else
(attribute access, names, calls to other things) is rejected, so the text is
never handed to eval().
"""

from __future__ import annotations

import ast
import math
import re

import casadi as ca

_FUNCS = {
    "sin": ca.sin, "cos": ca.cos, "tan": ca.tan,
    "asin": ca.asin, "arcsin": ca.asin, "acos": ca.acos, "arccos": ca.acos,
    "atan": ca.atan, "arctan": ca.atan, "atan2": ca.atan2, "arctan2": ca.atan2,
    "sinh": ca.sinh, "cosh": ca.cosh, "tanh": ca.tanh,
    "exp": ca.exp, "log": ca.log, "ln": ca.log, "log10": ca.log10, "sqrt": ca.sqrt,
    "abs": ca.fabs, "min": ca.fmin, "max": ca.fmax, "pow": lambda a, b: a ** b,
    "sign": ca.sign, "floor": ca.floor, "ceil": ca.ceil,
}
_CONSTS = {"pi": math.pi, "e": math.e}
_BIN = {
    ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b, ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a ** b, ast.Mod: lambda a, b: ca.fmod(a, b),
}
NON_SMOOTH = {"abs", "min", "max", "sign", "floor", "ceil"}
FUNC_NAMES = sorted(_FUNCS)


def _prep(text: str) -> str:
    s = text.strip().replace("^", "**").replace("×", "*").replace("−", "-")
    # a single "=" is an equality, not an assignment
    s = re.sub(r"(?<![<>=!])=(?!=)", "==", s)
    if len(s) > 500:
        raise ValueError("수식이 너무 깁니다 (500자 이하)")
    return s


class _Builder:
    def __init__(self, names: dict[str, ca.SX]):
        self.names = names
        self.used: set[str] = set()

    def __call__(self, node):
        if isinstance(node, ast.Expression):
            return self(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) \
                and not isinstance(node.value, bool):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id in self.names:
                return self.names[node.id]
            if node.id in _CONSTS:
                return _CONSTS[node.id]
            raise ValueError(f"알 수 없는 이름: {node.id}  (변수는 {', '.join(self.names)})")
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            return _BIN[type(node.op)](self(node.left), self(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = self(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            name = node.func.id
            if name not in _FUNCS:
                raise ValueError(f"지원하지 않는 함수: {name}()")
            self.used.add(name)
            args = [self(a) for a in node.args]
            try:
                return _FUNCS[name](*args)
            except TypeError:
                raise ValueError(f"{name}() 의 인자 개수가 맞지 않습니다") from None
        raise ValueError(f"수식에 쓸 수 없는 구문입니다: {ast.unparse(node)[:40]}")


def _parse(text: str) -> ast.AST:
    try:
        return ast.parse(_prep(text), mode="eval")
    except SyntaxError:
        raise ValueError(f"수식을 읽을 수 없습니다: {text}") from None


def _names(X: ca.SX) -> dict[str, ca.SX]:
    if X.numel() == 1:
        return {"x": X[0], "x1": X[0]}
    return {"x": X[0], "y": X[1], "x1": X[0], "x2": X[1]}


def objective(text: str, X: ca.SX) -> tuple[ca.SX, bool]:
    """Expression of the objective, and whether it is smooth."""
    tree = _parse(text)
    if isinstance(tree.body, ast.Compare):
        raise ValueError("목적 함수에는 부등호/등호를 쓰지 않습니다")
    b = _Builder(_names(X))
    e = b(tree)
    return ca.SX(e) if not isinstance(e, ca.SX) else e, not (b.used & NON_SMOOTH)


def constraint(text: str, X: ca.SX) -> dict:
    """"lhs <= rhs" -> {expr: g, kind}, normalised so that the feasible set is
    g <= 0 (kind 'ineq') or g == 0 (kind 'eq')."""
    tree = _parse(text)
    body = tree.body
    if not isinstance(body, ast.Compare) or len(body.ops) != 1:
        raise ValueError(f"제약식은 'A <= B', 'A >= B', 'A = B' 꼴로 씁니다: {text}")
    b = _Builder(_names(X))
    lhs, rhs = b(body.left), b(body.comparators[0])
    op = body.ops[0]
    if isinstance(op, (ast.LtE, ast.Lt)):
        g, kind = lhs - rhs, "ineq"
    elif isinstance(op, (ast.GtE, ast.Gt)):
        g, kind = rhs - lhs, "ineq"
    elif isinstance(op, ast.Eq):
        g, kind = lhs - rhs, "eq"
    else:
        raise ValueError(f"지원하지 않는 비교 연산자입니다: {text}")
    g = ca.SX(g) if not isinstance(g, ca.SX) else g
    if not ca.depends_on(g, X):
        raise ValueError(f"제약식에 변수가 없습니다: {text}")
    return {"expr": g, "kind": kind, "text": text.strip()}
