DROP VIEW IF EXISTS most_critical_tickets;

CREATE VIEW IF NOT EXISTS most_critical_tickets AS
    SELECT
        t.id,
        t.project_id,
        MAX(tkc."order", COALESCE(bmo.max_order, tkc."order")) AS max_blocked_column,
        MIN(t.priority, COALESCE(bmp.min_prio, t.priority)) AS inherited_priority,
        COALESCE(bc.cnt, 0) AS blocked_ticket_count
    FROM tickets t
    JOIN kanban_columns tkc ON t.column_id = tkc.id
    LEFT JOIN (
        SELECT tb.depends_on_id, COUNT(*) AS cnt
        FROM ticket_blockers tb
        JOIN tickets blocker ON tb.ticket_id = blocker.id
        WHERE blocker.closed_at IS NULL
        GROUP BY tb.depends_on_id
    ) bc ON bc.depends_on_id = t.id
    LEFT JOIN (
        SELECT tb.depends_on_id, MIN(blocker.priority) AS min_prio
        FROM ticket_blockers tb
        JOIN tickets blocker ON tb.ticket_id = blocker.id
        WHERE blocker.closed_at IS NULL
        GROUP BY tb.depends_on_id
    ) bmp ON bmp.depends_on_id = t.id
    LEFT JOIN (
        SELECT tb.depends_on_id, MAX(blocker_col."order") AS max_order
        FROM ticket_blockers tb
        JOIN tickets blocker ON tb.ticket_id = blocker.id
        JOIN kanban_columns blocker_col ON blocker.column_id = blocker_col.id
        WHERE blocker.closed_at IS NULL
        AND blocker_col."order" < (
            SELECT col."order"
            FROM kanban_columns col
            WHERE col.slug = 'done'
        )
        GROUP BY tb.depends_on_id
    ) bmo ON bmo.depends_on_id = t.id
	LEFT JOIN ticket_blockers AS current_blocked ON current_blocked.ticket_id = t.id
    WHERE t.closed_at IS NULL AND current_blocked.depends_on_id IS NULL
    ORDER BY max_blocked_column DESC, inherited_priority ASC, blocked_ticket_count DESC, t.parent_id IS NULL DESC;
    