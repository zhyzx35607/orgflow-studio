/**
 * OrgFlow Studio — Safe Deterministic AST Expression Evaluator
 *
 * Zero `eval`, zero `new Function`, zero prototype traversal.
 * Supports arithmetic, comparison, logical operators, ternary expressions,
 * dot-path property lookup (`row.qty`, `applicant.dept`), array indexing,
 * and pure built-in functions (`SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `ROUND`,
 * `IF`, `ABS`, `COALESCE`, `LEN`, `INCLUDES`, `CONTAINS`, `UPPER`, `LOWER`).
 */

export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'BOOLEAN'
  | 'NULL'
  | 'IDENT'
  | 'OPERATOR'
  | 'PUNCT';

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export type AstNode =
  | { kind: 'Literal'; value: number | string | boolean | null }
  | { kind: 'Identifier'; name: string }
  | { kind: 'MemberAccess'; object: AstNode; property: string }
  | { kind: 'IndexAccess'; object: AstNode; index: AstNode }
  | { kind: 'ArrayLiteral'; elements: AstNode[] }
  | { kind: 'UnaryExpr'; operator: '-' | '+' | '!'; argument: AstNode }
  | { kind: 'BinaryExpr'; operator: string; left: AstNode; right: AstNode }
  | { kind: 'TernaryExpr'; test: AstNode; consequent: AstNode; alternate: AstNode }
  | { kind: 'CallExpr'; callee: string; args: AstNode[] };

const FORBIDDEN_IDENTIFIERS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'window',
  'globalThis',
  'document',
  'Function',
  'eval',
  'process',
]);

const MAX_EXPRESSION_LENGTH = 2048;
const MAX_AST_DEPTH = 48;

export class ExpressionSyntaxError extends Error {
  public readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (at position ${position})`);
    this.name = 'ExpressionSyntaxError';
    this.position = position;
  }
}

export function tokenizeExpression(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionSyntaxError(
      `Expression exceeds max length of ${MAX_EXPRESSION_LENGTH} chars`,
      0,
    );
  }

  const tokens: Token[] = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // Numbers (integer or decimal)
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < len && /[0-9]/.test(source[i + 1]))) {
      const start = i;
      let hasDot = false;
      while (i < len && (/[0-9]/.test(source[i]) || (!hasDot && source[i] === '.'))) {
        if (source[i] === '.') hasDot = true;
        i += 1;
      }
      tokens.push({ type: 'NUMBER', value: source.slice(start, i), pos: start });
      continue;
    }

    // String literals ('...' or "...")
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i += 1;
      let buf = '';
      let closed = false;
      while (i < len) {
        const cur = source[i];
        if (cur === '\\') {
          if (i + 1 >= len) {
            throw new ExpressionSyntaxError('Unterminated escape sequence', i);
          }
          const next = source[i + 1];
          if (next === 'n') buf += '\n';
          else if (next === 't') buf += '\t';
          else buf += next;
          i += 2;
          continue;
        }
        if (cur === quote) {
          closed = true;
          i += 1;
          break;
        }
        buf += cur;
        i += 1;
      }
      if (!closed) {
        throw new ExpressionSyntaxError('Unterminated string literal', start);
      }
      tokens.push({ type: 'STRING', value: buf, pos: start });
      continue;
    }

    // Multi-char operators
    const threeChar = source.slice(i, i + 3);
    if (threeChar === '===' || threeChar === '!==') {
      tokens.push({ type: 'OPERATOR', value: threeChar.slice(0, 2), pos: i });
      i += 3;
      continue;
    }

    const twoChar = source.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(twoChar)) {
      tokens.push({ type: 'OPERATOR', value: twoChar, pos: i });
      i += 2;
      continue;
    }

    // Single-char operators
    if (['+', '-', '*', '/', '%', '>', '<', '!'].includes(ch)) {
      tokens.push({ type: 'OPERATOR', value: ch, pos: i });
      i += 1;
      continue;
    }

    // Punctuation
    if (['(', ')', '[', ']', ',', '.', '?', ':'].includes(ch)) {
      tokens.push({ type: 'PUNCT', value: ch, pos: i });
      i += 1;
      continue;
    }

    // Identifiers and keywords
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < len && /[A-Za-z0-9_$]/.test(source[i])) {
        i += 1;
      }
      const word = source.slice(start, i);
      if (FORBIDDEN_IDENTIFIERS.has(word)) {
        throw new ExpressionSyntaxError(`Forbidden identifier "${word}"`, start);
      }
      if (word === 'true' || word === 'false') {
        tokens.push({ type: 'BOOLEAN', value: word, pos: start });
      } else if (word === 'null' || word === 'undefined') {
        tokens.push({ type: 'NULL', value: 'null', pos: start });
      } else if (word === 'AND' || word === 'and') {
        tokens.push({ type: 'OPERATOR', value: '&&', pos: start });
      } else if (word === 'OR' || word === 'or') {
        tokens.push({ type: 'OPERATOR', value: '||', pos: start });
      } else if (word === 'NOT' || word === 'not') {
        tokens.push({ type: 'OPERATOR', value: '!', pos: start });
      } else {
        tokens.push({ type: 'IDENT', value: word, pos: start });
      }
      continue;
    }

    throw new ExpressionSyntaxError(`Unexpected character "${ch}"`, i);
  }

  return tokens;
}

class Parser {
  private readonly tokens: Token[];
  private cursor = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): AstNode {
    if (this.tokens.length === 0) {
      throw new ExpressionSyntaxError('Empty expression', 0);
    }
    const root = this.parseTernary(0);
    if (this.cursor < this.tokens.length) {
      const extra = this.tokens[this.cursor];
      throw new ExpressionSyntaxError(`Unexpected token "${extra.value}"`, extra.pos);
    }
    return root;
  }

  private checkDepth(depth: number): void {
    if (depth > MAX_AST_DEPTH) {
      const pos = this.peek()?.pos ?? 0;
      throw new ExpressionSyntaxError('Maximum expression nesting depth exceeded', pos);
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }

  private consume(): Token {
    const tok = this.tokens[this.cursor];
    if (!tok) {
      throw new ExpressionSyntaxError('Unexpected end of expression', this.tokens.length);
    }
    this.cursor += 1;
    return tok;
  }

  private match(type: TokenType, value?: string): boolean {
    const tok = this.peek();
    if (!tok || tok.type !== type) return false;
    if (value !== undefined && tok.value !== value) return false;
    this.cursor += 1;
    return true;
  }

  private expect(type: TokenType, value?: string): Token {
    const tok = this.peek();
    if (!tok || tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new ExpressionSyntaxError(
        `Expected ${value ?? type} but got "${tok?.value ?? 'EOF'}"`,
        tok?.pos ?? 0,
      );
    }
    return this.consume();
  }

  private parseTernary(depth: number): AstNode {
    this.checkDepth(depth);
    const test = this.parseLogicalOr(depth + 1);
    if (this.match('PUNCT', '?')) {
      const consequent = this.parseTernary(depth + 1);
      this.expect('PUNCT', ':');
      const alternate = this.parseTernary(depth + 1);
      return { kind: 'TernaryExpr', test, consequent, alternate };
    }
    return test;
  }

  private parseLogicalOr(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseLogicalAnd(depth + 1);
    while (this.match('OPERATOR', '||')) {
      const right = this.parseLogicalAnd(depth + 1);
      left = { kind: 'BinaryExpr', operator: '||', left, right };
    }
    return left;
  }

  private parseLogicalAnd(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseEquality(depth + 1);
    while (this.match('OPERATOR', '&&')) {
      const right = this.parseEquality(depth + 1);
      left = { kind: 'BinaryExpr', operator: '&&', left, right };
    }
    return left;
  }

  private parseEquality(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseComparison(depth + 1);
    while (true) {
      const tok = this.peek();
      if (tok?.type === 'OPERATOR' && (tok.value === '==' || tok.value === '!=')) {
        this.consume();
        const right = this.parseComparison(depth + 1);
        left = { kind: 'BinaryExpr', operator: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseComparison(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseAdditive(depth + 1);
    while (true) {
      const tok = this.peek();
      if (tok?.type === 'OPERATOR' && ['>', '<', '>=', '<='].includes(tok.value)) {
        this.consume();
        const right = this.parseAdditive(depth + 1);
        left = { kind: 'BinaryExpr', operator: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseAdditive(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseMultiplicative(depth + 1);
    while (true) {
      const tok = this.peek();
      if (tok?.type === 'OPERATOR' && (tok.value === '+' || tok.value === '-')) {
        this.consume();
        const right = this.parseMultiplicative(depth + 1);
        left = { kind: 'BinaryExpr', operator: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseMultiplicative(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseUnary(depth + 1);
    while (true) {
      const tok = this.peek();
      if (tok?.type === 'OPERATOR' && ['*', '/', '%'].includes(tok.value)) {
        this.consume();
        const right = this.parseUnary(depth + 1);
        left = { kind: 'BinaryExpr', operator: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnary(depth: number): AstNode {
    this.checkDepth(depth);
    const tok = this.peek();
    if (tok?.type === 'OPERATOR' && (tok.value === '-' || tok.value === '+' || tok.value === '!')) {
      this.consume();
      const argument = this.parseUnary(depth + 1);
      return {
        kind: 'UnaryExpr',
        operator: tok.value as '-' | '+' | '!',
        argument,
      };
    }
    return this.parsePostfix(depth + 1);
  }

  private parsePostfix(depth: number): AstNode {
    this.checkDepth(depth);
    let node = this.parsePrimary(depth + 1);

    while (true) {
      if (this.match('PUNCT', '.')) {
        const prop = this.expect('IDENT');
        if (FORBIDDEN_IDENTIFIERS.has(prop.value)) {
          throw new ExpressionSyntaxError(`Forbidden property "${prop.value}"`, prop.pos);
        }
        node = { kind: 'MemberAccess', object: node, property: prop.value };
      } else if (this.match('PUNCT', '[')) {
        const index = this.parseTernary(depth + 1);
        this.expect('PUNCT', ']');
        node = { kind: 'IndexAccess', object: node, index };
      } else {
        break;
      }
    }

    return node;
  }

  private parsePrimary(depth: number): AstNode {
    this.checkDepth(depth);
    const tok = this.peek();
    if (!tok) {
      throw new ExpressionSyntaxError('Unexpected end of input', 0);
    }

    if (tok.type === 'NUMBER') {
      this.consume();
      return { kind: 'Literal', value: Number(tok.value) };
    }

    if (tok.type === 'STRING') {
      this.consume();
      return { kind: 'Literal', value: tok.value };
    }

    if (tok.type === 'BOOLEAN') {
      this.consume();
      return { kind: 'Literal', value: tok.value === 'true' };
    }

    if (tok.type === 'NULL') {
      this.consume();
      return { kind: 'Literal', value: null };
    }

    if (tok.type === 'PUNCT' && tok.value === '(') {
      this.consume();
      const inner = this.parseTernary(depth + 1);
      this.expect('PUNCT', ')');
      return inner;
    }

    if (tok.type === 'PUNCT' && tok.value === '[') {
      this.consume();
      const elements: AstNode[] = [];
      if (!this.match('PUNCT', ']')) {
        do {
          elements.push(this.parseTernary(depth + 1));
        } while (this.match('PUNCT', ','));
        this.expect('PUNCT', ']');
      }
      return { kind: 'ArrayLiteral', elements };
    }

    if (tok.type === 'IDENT') {
      this.consume();
      if (this.match('PUNCT', '(')) {
        const args: AstNode[] = [];
        if (!this.match('PUNCT', ')')) {
          do {
            args.push(this.parseTernary(depth + 1));
          } while (this.match('PUNCT', ','));
          this.expect('PUNCT', ')');
        }
        return { kind: 'CallExpr', callee: tok.value.toUpperCase(), args };
      }
      return { kind: 'Identifier', name: tok.value };
    }

    throw new ExpressionSyntaxError(`Unexpected token "${tok.value}"`, tok.pos);
  }
}

export function parseExpression(source: string): AstNode {
  const tokens = tokenizeExpression(source);
  return new Parser(tokens).parse();
}

function toFiniteNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isTruthy(val: unknown): boolean {
  if (Array.isArray(val)) return val.length > 0;
  return Boolean(val);
}

function extractNumericSeries(args: unknown[]): number[] {
  if (args.length === 0) return [];
  // Support SUM(items, 'subtotal') or SUM([10, 20, 30]) or SUM(10, 20)
  if (Array.isArray(args[0]) && typeof args[1] === 'string') {
    const fieldKey = args[1];
    if (FORBIDDEN_IDENTIFIERS.has(fieldKey)) return [];
    return args[0].map((row) => {
      if (row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, fieldKey)) {
        return toFiniteNumber((row as Record<string, unknown>)[fieldKey]);
      }
      return 0;
    });
  }
  const nums: number[] = [];
  for (const item of args) {
    if (Array.isArray(item)) {
      for (const sub of item) {
        nums.push(toFiniteNumber(sub));
      }
    } else {
      nums.push(toFiniteNumber(item));
    }
  }
  return nums;
}

type BuiltinFn = (args: unknown[]) => unknown;

const BUILTIN_FUNCTIONS: Record<string, BuiltinFn> = {
  SUM: (args) => {
    const series = extractNumericSeries(args);
    return series.reduce((acc, v) => acc + v, 0);
  },
  AVG: (args) => {
    const series = extractNumericSeries(args);
    if (series.length === 0) return 0;
    return series.reduce((acc, v) => acc + v, 0) / series.length;
  },
  MIN: (args) => {
    const series = extractNumericSeries(args);
    return series.length === 0 ? 0 : Math.min(...series);
  },
  MAX: (args) => {
    const series = extractNumericSeries(args);
    return series.length === 0 ? 0 : Math.max(...series);
  },
  COUNT: (args) => {
    if (Array.isArray(args[0])) {
      if (typeof args[1] === 'string') {
        const key = args[1];
        return args[0].filter(
          (r) =>
            r &&
            typeof r === 'object' &&
            (r as Record<string, unknown>)[key] !== undefined &&
            (r as Record<string, unknown>)[key] !== '' &&
            (r as Record<string, unknown>)[key] !== null,
        ).length;
      }
      return args[0].length;
    }
    return args.filter((v) => v !== null && v !== undefined && v !== '').length;
  },
  ROUND: (args) => {
    const value = toFiniteNumber(args[0]);
    const decimals = Math.max(0, Math.min(8, Math.trunc(toFiniteNumber(args[1] ?? 2))));
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  },
  ABS: (args) => Math.abs(toFiniteNumber(args[0])),
  IF: (args) => (isTruthy(args[0]) ? (args[1] ?? null) : (args[2] ?? null)),
  COALESCE: (args) => {
    for (const item of args) {
      if (item !== null && item !== undefined && item !== '') return item;
    }
    return null;
  },
  LEN: (args) => {
    const target = args[0];
    if (typeof target === 'string' || Array.isArray(target)) return target.length;
    return 0;
  },
  INCLUDES: (args) => {
    const container = args[0];
    const needle = args[1];
    if (Array.isArray(container)) return container.includes(needle);
    if (typeof container === 'string') return container.includes(String(needle ?? ''));
    return false;
  },
  CONTAINS: (args) => BUILTIN_FUNCTIONS.INCLUDES(args),
  UPPER: (args) => String(args[0] ?? '').toUpperCase(),
  LOWER: (args) => String(args[0] ?? '').toLowerCase(),
};

function safeGetProperty(target: unknown, key: string): unknown {
  if (FORBIDDEN_IDENTIFIERS.has(key)) return undefined;
  if (target === null || target === undefined) return undefined;
  if (typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, key)) {
    return (target as Record<string, unknown>)[key];
  }
  return undefined;
}

export function evaluateAst(node: AstNode, scope: Record<string, unknown>): unknown {
  switch (node.kind) {
    case 'Literal':
      return node.value;

    case 'Identifier':
      return safeGetProperty(scope, node.name);

    case 'MemberAccess': {
      const obj = evaluateAst(node.object, scope);
      // Support mapping over an array of objects: e.g. items.subtotal -> [100, 200]
      if (Array.isArray(obj)) {
        return obj.map((item) => safeGetProperty(item, node.property));
      }
      return safeGetProperty(obj, node.property);
    }

    case 'IndexAccess': {
      const obj = evaluateAst(node.object, scope);
      const idx = evaluateAst(node.index, scope);
      if (Array.isArray(obj) && typeof idx === 'number') {
        const normalized = Math.trunc(idx);
        return normalized >= 0 && normalized < obj.length ? obj[normalized] : undefined;
      }
      if (obj && typeof obj === 'object' && typeof idx === 'string') {
        return safeGetProperty(obj, idx);
      }
      return undefined;
    }

    case 'ArrayLiteral':
      return node.elements.map((el) => evaluateAst(el, scope));

    case 'UnaryExpr': {
      const arg = evaluateAst(node.argument, scope);
      if (node.operator === '!') return !isTruthy(arg);
      if (node.operator === '-') return -toFiniteNumber(arg);
      return toFiniteNumber(arg);
    }

    case 'TernaryExpr': {
      const cond = evaluateAst(node.test, scope);
      return isTruthy(cond)
        ? evaluateAst(node.consequent, scope)
        : evaluateAst(node.alternate, scope);
    }

    case 'BinaryExpr': {
      if (node.operator === '&&') {
        const left = evaluateAst(node.left, scope);
        return isTruthy(left) ? isTruthy(evaluateAst(node.right, scope)) : false;
      }
      if (node.operator === '||') {
        const left = evaluateAst(node.left, scope);
        return isTruthy(left) ? true : isTruthy(evaluateAst(node.right, scope));
      }

      const left = evaluateAst(node.left, scope);
      const right = evaluateAst(node.right, scope);

      switch (node.operator) {
        case '+':
          if (typeof left === 'string' || typeof right === 'string') {
            if (typeof left === 'number' || typeof right === 'number') {
              // Numeric addition if both look numeric, otherwise string concat when string literal present
              if (typeof left === 'string' && typeof right === 'string') {
                return left + right;
              }
            }
            if (typeof left === 'string' && isNaN(Number(left))) {
              return `${left}${String(right ?? '')}`;
            }
            if (typeof right === 'string' && isNaN(Number(right))) {
              return `${String(left ?? '')}${right}`;
            }
          }
          return toFiniteNumber(left) + toFiniteNumber(right);
        case '-':
          return toFiniteNumber(left) - toFiniteNumber(right);
        case '*':
          return toFiniteNumber(left) * toFiniteNumber(right);
        case '/': {
          const divisor = toFiniteNumber(right);
          return divisor === 0 ? 0 : toFiniteNumber(left) / divisor;
        }
        case '%': {
          const divisor = toFiniteNumber(right);
          return divisor === 0 ? 0 : toFiniteNumber(left) % divisor;
        }
        case '==':
          return left === right || (left == null && right == null);
        case '!=':
          return !(left === right || (left == null && right == null));
        case '>':
          return toFiniteNumber(left) > toFiniteNumber(right);
        case '<':
          return toFiniteNumber(left) < toFiniteNumber(right);
        case '>=':
          return toFiniteNumber(left) >= toFiniteNumber(right);
        case '<=':
          return toFiniteNumber(left) <= toFiniteNumber(right);
        default:
          throw new Error(`Unsupported binary operator "${node.operator}"`);
      }
    }

    case 'CallExpr': {
      if (node.callee === 'IF') {
        const cond = evaluateAst(node.args[0], scope);
        if (isTruthy(cond)) {
          return node.args[1] ? evaluateAst(node.args[1], scope) : null;
        }
        return node.args[2] ? evaluateAst(node.args[2], scope) : null;
      }
      const fn = BUILTIN_FUNCTIONS[node.callee];
      if (!fn) {
        throw new ExpressionSyntaxError(`Unknown function "${node.callee}"`, 0);
      }
      const evaluatedArgs = node.args.map((arg) => evaluateAst(arg, scope));
      return fn(evaluatedArgs);
    }
  }
}

export function evaluateExpression(
  expression: string,
  scope: Record<string, unknown>,
): unknown {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  const ast = parseExpression(trimmed);
  return evaluateAst(ast, scope);
}

export function evaluateBooleanExpression(
  expression: string | undefined,
  scope: Record<string, unknown>,
  defaultWhenEmpty = true,
): boolean {
  if (!expression || !expression.trim()) return defaultWhenEmpty;
  const result = evaluateExpression(expression, scope);
  return isTruthy(result);
}
