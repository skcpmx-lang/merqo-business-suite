/**
 * Migration 0004 — RC hardening schema.
 *
 *  - sales_returns.cogs_paise: cost of goods included in a (restocked)
 *    sales return. Profit/reconciliation aggregates must net this out so a
 *    returned sale never keeps its cost while losing its revenue (§116:
 *    dashboard and reports share the same logic).
 *  - Backfill: for every existing return, recompute COGS from the sale
 *    line's recorded cost (pro-rated by quantity, restocked lines only).
 *  - The new `sales.creditOverride` permission is added to the global
 *    catalog (idempotent seedPermissions call in the runner) and granted
 *    to the built-in full-access roles for pre-existing businesses.
 */
const sql = `
ALTER TABLE sales_returns ADD COLUMN cogs_paise INTEGER NOT NULL DEFAULT 0;

-- Backfill COGS from the originating sale lines (restocked lines only).
UPDATE sales_returns
SET cogs_paise = COALESCE((
    SELECT SUM(ROUND(sri.quantity * si.cogs_paise * 1.0 / NULLIF(si.quantity, 0)))
    FROM sales_return_items sri
    JOIN sale_items si ON si.id = sri.sale_item_id
    WHERE sri.return_id = sales_returns.id AND sri.restock = 1
  ), 0);

-- Grant the new credit-limit override permission to built-in full-access
-- roles created before this permission existed (INSERT OR IGNORE is safe
-- on the (role_id, permission_key) primary key).
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'sales.creditOverride'
FROM roles r
WHERE r.key IN ('owner', 'administrator', 'manager');
`;

export { sql as m0004_return_cogs };
