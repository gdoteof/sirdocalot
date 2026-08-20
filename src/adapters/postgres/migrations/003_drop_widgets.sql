-- The widget registry is the shipped set, so this table held a copy of a
-- constant that a boot-time upsert kept in agreement with its original.
--
-- Runtime definition is gone deliberately: any agent could define a widget every
-- other agent then saw, and could overwrite one another agent had made. A widget
-- is now a reviewed change to domain/builtin-widgets.ts, which makes the code the
-- registry and this table nothing.
drop table if exists widgets;
