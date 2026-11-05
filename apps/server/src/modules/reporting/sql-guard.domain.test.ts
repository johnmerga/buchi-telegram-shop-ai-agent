import { describe, expect, it } from 'vitest';
import { checkQuery, MAX_ROWS } from './sql-guard.domain';

function accepted(text: string): string {
  const checked = checkQuery(text);
  if (checked.status !== 'ok') throw new Error(`Rejected: ${checked.reason}`);
  return checked.sql;
}

describe('checkQuery', () => {
  it('accepts a SELECT over a reporting view and keeps its limit', () => {
    const sql = accepted(
      "select product_title, sum(quantity) as units from report_sales where sold_at >= now() - interval '7 days' group by product_title order by units desc limit 5",
    );
    expect(sql).toContain('FROM "report_sales"');
    expect(sql).toMatch(/LIMIT 5$/);
  });

  it(`adds a limit of ${String(MAX_ROWS)} rows, and lowers a larger one`, () => {
    expect(accepted('select * from report_orders')).toMatch(
      new RegExp(`LIMIT ${String(MAX_ROWS)}$`),
    );
    expect(accepted('select * from report_orders limit 5000')).toMatch(
      new RegExp(`LIMIT ${String(MAX_ROWS)}$`),
    );
  });

  it('accepts joins, casts, CTEs over the views, and allowed functions', () => {
    accepted(
      "with weekly as (select date_trunc('week', sold_at)::date as week, sum(line_total) as revenue from report_sales group by 1) select week, coalesce(revenue, 0) from weekly order by week",
    );
    accepted(
      'select s.size, count(*) from report_sales s join report_stock k on k.product_id = s.product_id group by s.size',
    );
    accepted('select extract(dow from created_at) as day, count(*) from report_orders group by 1');
  });

  it.each([
    ['an UPDATE', 'update orders set total = 0'],
    ['a DELETE', 'delete from report_orders'],
    ['two statements', 'select 1 from report_orders; select 2 from report_orders'],
    ['a table outside the allowlist', 'select phone from customers'],
    [
      'a subquery over a table',
      'select * from report_sales where order_id in (select id from orders)',
    ],
    ['a CTE over a table', 'with o as (select * from orders) select * from o'],
    ['a system catalog', 'select * from pg_catalog.pg_class'],
    ['a system view without a schema', 'select * from pg_roles'],
    ['information_schema', 'select * from information_schema.tables'],
    ['a function outside the allowlist', 'select pg_sleep(10) from report_orders'],
    ['a settings read', "select current_setting('app.shop_id')"],
    ['a schema-qualified function', 'select public.count(*) from report_orders'],
    ['SELECT INTO', 'select * into stolen from report_orders'],
    ['a view with a schema', 'select * from public.report_orders'],
    ['text that is not SQL', 'which product sold most?'],
    ['a limit that is not a number', 'select * from report_orders limit (select 1)'],
  ])('rejects %s', (_case, text) => {
    expect(checkQuery(text).status).toBe('rejected');
  });

  it('explains which views it may use', () => {
    expect(checkQuery('select * from orders')).toEqual({
      status: 'rejected',
      reason: expect.stringContaining('report_sales') as string,
    });
  });
});
