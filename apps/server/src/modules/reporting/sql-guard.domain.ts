import nodeSqlParser, { type AST } from 'node-sql-parser';

/** The reporting views, created in migration 0022. Model-written queries may read only these. */
export const reportingViews = [
  'report_orders',
  'report_sales',
  'report_stock',
  'report_deliveries',
  'report_drivers',
  'report_demand',
  'report_waitlist',
] as const;

/** Aggregates, date and text helpers, and nothing that reads settings, files, or other tables. */
const allowedFunctions = new Set([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'round',
  'ceil',
  'floor',
  'abs',
  'coalesce',
  'nullif',
  'greatest',
  'least',
  'lower',
  'upper',
  'length',
  'date_trunc',
  'date_part',
  'to_char',
  'now',
  'current_date',
  'current_timestamp',
  'row_number',
  'rank',
]);

/** The most rows a question can return, also enforced as the query's `LIMIT`. */
export const MAX_ROWS = 200;

export type CheckedQuery = { status: 'ok'; sql: string } | { status: 'rejected'; reason: string };

const options = { database: 'PostgresQL' };
const parser = new nodeSqlParser.Parser();

/**
 * Checks a model-written query before it reaches the database: one `SELECT`, only over the
 * reporting views (or its own CTEs), only allowed functions, no `INTO`, and a `LIMIT` of at most
 * `MAX_ROWS`. Returns the query as the parser prints it, so what runs is exactly what was checked.
 */
export function checkQuery(text: string): CheckedQuery {
  let parsed: AST | AST[];
  try {
    parsed = parser.astify(text, options);
  } catch {
    return rejected('The query is not valid SQL.');
  }
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  const [statement] = statements;
  if (statements.length !== 1 || !statement) return rejected('Send exactly one statement.');
  const select: unknown = statement;
  if (!isRecord(select) || select.type !== 'select') {
    return rejected('Only SELECT queries are allowed.');
  }

  const tablesProblem = checkTables(text, cteNames(select));
  if (tablesProblem) return rejected(tablesProblem);
  const nodeProblem = firstProblem(select);
  if (nodeProblem) return rejected(nodeProblem);
  const limitProblem = capLimit(select);
  if (limitProblem) return rejected(limitProblem);
  return { status: 'ok', sql: parser.sqlify(statement, options) };
}

function rejected(reason: string): CheckedQuery {
  return { status: 'rejected', reason };
}

/** Entries look like "select::null::report_sales": the statement type, the schema, and the name. */
function checkTables(text: string, ctes: Set<string>): string | undefined {
  const allowed = new Set<string>([...reportingViews, ...ctes]);
  for (const entry of parser.tableList(text, options)) {
    const [type, schema, table = ''] = entry.split('::');
    if (type !== 'select') return 'Only SELECT queries are allowed.';
    if (schema !== 'null') return `Use the reporting views without a schema, not ${schema ?? ''}.`;
    if (!allowed.has(table.toLowerCase())) {
      return `"${table}" is not a reporting view. Use only: ${reportingViews.join(', ')}.`;
    }
  }
  return undefined;
}

/** The names of every CTE in the statement, at any depth. */
function cteNames(node: unknown): Set<string> {
  const names = new Set<string>();
  visit(node, (object) => {
    const ctes = object.with;
    if (!Array.isArray(ctes)) return;
    for (const cte of ctes) {
      const name = valueOf(field(cte, 'name'));
      if (name) names.add(name.toLowerCase());
    }
  });
  return names;
}

function firstProblem(statement: unknown): string | undefined {
  let problem: string | undefined;
  visit(statement, (object) => {
    if (problem) return;
    if (object.type === 'function' || object.type === 'aggr_func') {
      const name = functionName(object);
      if (!name || !allowedFunctions.has(name)) {
        problem = `The function ${name ?? 'used'} is not allowed.`;
      }
    }
    if (isRecord(object.into) && object.into.position !== null) {
      problem = 'SELECT INTO is not allowed.';
    }
  });
  return problem;
}

/** A schema-qualified function has no allowed name, so it is refused like an unknown one. */
function functionName(node: Record<string, unknown>): string | undefined {
  if (typeof node.name === 'string') return node.name.toLowerCase();
  if (!isRecord(node.name) || node.name.schema) return undefined;
  const parts = node.name.name;
  if (!Array.isArray(parts) || parts.length !== 1) return undefined;
  return valueOf(parts[0])?.toLowerCase();
}

function capLimit(statement: Record<string, unknown>): string | undefined {
  const limit = isRecord(statement.limit) ? statement.limit : { seperator: '', value: [] };
  const values: unknown[] = Array.isArray(limit.value) ? limit.value : [];
  const first = values[0];
  if (first === undefined) {
    statement.limit = { seperator: '', value: [{ type: 'number', value: MAX_ROWS }] };
    return undefined;
  }
  if (!isRecord(first) || first.type !== 'number' || typeof first.value !== 'number') {
    return 'Use a plain number as the LIMIT.';
  }
  first.value = Math.min(first.value, MAX_ROWS);
  statement.limit = limit;
  return undefined;
}

function visit(node: unknown, act: (object: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) visit(child, act);
    return;
  }
  if (!isRecord(node)) return;
  act(node);
  for (const child of Object.values(node)) visit(child, act);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function valueOf(node: unknown): string | undefined {
  const value = field(node, 'value');
  return typeof value === 'string' ? value : undefined;
}
