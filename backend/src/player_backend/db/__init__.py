"""Data access (ADR 0002, section 9).

`executor/` is the only holder of the database driver. Everything else here (data-access modules,
the migration runner, the operator's commands) gets a handle from it and runs registered
`Query` constants of `queries/`.
"""
