# Requirement conflicts (F04 first slice)

The **Decisions → Conflicting requirements** section compares explicit card acceptance criteria. It does not infer meaning from titles or arbitrary prose.

1. Create concrete acceptance criteria on two cards. In **Decisions**, select each source criterion and mark its component, scope, property, and stance (**required** or **forbidden**). The original criterion text stays unchanged.
2. Branchloom shows a possible conflict only when two active rules belong to different cards, have the same normalized component, scope, and property, and have opposite stances. The UI displays both verbatim statements, card links, the presumed common scope, and why the pair was flagged.
3. Choose which source rule applies or dismiss the hint as different contexts. A reason is mandatory. The main process rechecks both criteria and card content revisions immediately before saving. If either changed, the decision is rejected until the sources are refreshed and reviewed again.
4. The decision is append-only evidence with both original statements and card revision numbers. It appears in the decision history and on both card panels after restart. A later card edit marks the old decision historical. Removing a classification does not delete an earlier decision or change either criterion.

This is a deterministic aid for deliberately classified rules. A shared key is not proof of a real contradiction; the user decides. Classification, refreshing, and resolving are manual. A changed card revision conservatively marks its rule stale even if the edit did not affect that criterion. The view checks at most 200 active rules and displays at most 100 hints and 500 decisions per project, with a visible limit notice. Semantic suggestions, automatic classification of incoming cards, and more complex conditions remain open.
