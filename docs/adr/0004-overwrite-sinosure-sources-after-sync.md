# Overwrite Sinosure sources only after a current sync

CAP Analytics may export Sinosure data back over its mapped source file because users edit operational data in CAP. This intentionally deviates from append-only export: an overwrite is permitted only after the source has been synchronized at its latest version, and CAP records the user and time of every export so shared WeDrive files are not replaced from stale CAP data.
