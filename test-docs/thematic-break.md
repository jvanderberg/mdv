# Thematic Breaks

These cases come from the upstream smart-typography regression fixed after tables:
smart punctuation must not rewrite Markdown syntax before the parser sees it.

---

----

*****

_ _ _

- - -

This is a second-level heading
----

This prose sentence should still smarten word --- word.

The year range 2020--2025 should use an en dash.

The flag examples `--verbose` and `--output` should remain literal.

| Input | Output |
| --- | --- |
| "quoted" | word --- word |
